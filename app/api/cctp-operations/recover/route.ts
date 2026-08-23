import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CCTP_TESTNET_DOMAINS, type CctpSourceChain } from "@/lib/arc/config";
import { formatUsdc } from "@/lib/money";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase, type Database, type StoredCctpOperation, type StoredInvoice } from "@/lib/server/store";

const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const EVM_SOURCES = ["Base_Sepolia", "Arbitrum_Sepolia", "Ethereum_Sepolia"] as const satisfies readonly CctpSourceChain[];

const SOURCE_EXPLORERS: Record<(typeof EVM_SOURCES)[number], { api: string; web: string }> = {
  Base_Sepolia: { api: "https://base-sepolia.blockscout.com", web: "https://sepolia.basescan.org/tx" },
  Arbitrum_Sepolia: { api: "https://arbitrum-sepolia.blockscout.com", web: "https://sepolia.arbiscan.io/tx" },
  Ethereum_Sepolia: { api: "https://eth-sepolia.blockscout.com", web: "https://sepolia.etherscan.io/tx" },
};

type ExplorerTransaction = {
  hash?: string;
  timestamp?: string;
  method?: string;
  from?: { hash?: string } | string;
};

type IrisMessage = {
  status?: string;
  forwardState?: "PENDING" | "CONFIRMED" | "COMPLETE" | "FAILED" | null;
  forwardTxHash?: string | null;
  decodedMessage?: {
    destinationDomain?: string | number;
    decodedMessageBody?: { mintRecipient?: string; amount?: string };
  };
};

type Candidate = { hash: string; sourceChain: (typeof EVM_SOURCES)[number]; createdAt: string };

function isEvmSource(value: unknown): value is Candidate["sourceChain"] {
  return typeof value === "string" && (EVM_SOURCES as readonly string[]).includes(value);
}

function senderOf(transaction: ExplorerTransaction) {
  return typeof transaction.from === "string" ? transaction.from : transaction.from?.hash ?? "";
}

async function discoverTransactions(walletAddress: string, sourceChain: Candidate["sourceChain"]): Promise<{ available: boolean; candidates: Candidate[] }> {
  const source = SOURCE_EXPLORERS[sourceChain];
  try {
    const response = await fetch(`${source.api}/api/v2/addresses/${walletAddress}/transactions`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { available: false, candidates: [] };
    const payload = await response.json() as { items?: ExplorerTransaction[] };
    const sent = (payload.items ?? []).filter((transaction) => senderOf(transaction).toLowerCase() === walletAddress.toLowerCase() && TX_HASH.test(transaction.hash ?? ""));
    const likelyCctp = sent.filter((transaction) => /burn|bridge|cctp/i.test(transaction.method ?? ""));
    // Decoded method names are normally present. The bounded fallback also catches
    // proxy/wrapper calls where an explorer has not decoded the method yet.
    const selected = likelyCctp.length ? likelyCctp : sent.slice(0, 30);
    return { available: true, candidates: selected.slice(0, 40).map((transaction) => ({
      hash: transaction.hash as string,
      sourceChain,
      createdAt: transaction.timestamp && !Number.isNaN(Date.parse(transaction.timestamp)) ? new Date(transaction.timestamp).toISOString() : new Date().toISOString(),
    })) };
  } catch {
    return { available: false, candidates: [] };
  }
}

async function queryIris(candidate: Candidate): Promise<IrisMessage | null> {
  try {
    const domain = CCTP_TESTNET_DOMAINS[candidate.sourceChain];
    const response = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${encodeURIComponent(candidate.hash)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { messages?: IrisMessage[] };
    return payload.messages?.find((message) => Number(message.decodedMessage?.destinationDomain) === 26) ?? null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

function addressFromBytes32(value: string | undefined) {
  const normalized = String(value ?? "").replace(/^0x/, "");
  return normalized.length >= 40 ? `0x${normalized.slice(-40)}` : "";
}

function finalizeRecovered(database: Database, operation: StoredCctpOperation) {
  if (!operation.mintTxHash || operation.invoiceId) return;
  const invoice: StoredInvoice = {
    id: randomUUID(), senderId: operation.ownerId,
    recipientUserId: operation.recipientUserId, recipientAddress: operation.recipientAddress,
    recipientLabel: operation.recipientLabel, amount: operation.amount, token: "USDC",
    fundingMethod: "cctp_bridge", sourceChain: operation.sourceChain, protocol: "cctp",
    bridgeSteps: operation.bridgeSteps, txHash: operation.mintTxHash,
    explorerUrl: operation.mintExplorerUrl ?? `https://testnet.arcscan.app/tx/${operation.mintTxHash}`,
    status: "confirmed", memo: operation.memo, createdAt: operation.createdAt,
  };
  database.invoices.push(invoice);
  operation.invoiceId = invoice.id;
  operation.status = "confirmed";
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!current.walletAddress) return NextResponse.json({ error: "Connect and bind an EVM wallet before recovering CCTP activity" }, { status: 400 });

  const input = await request.json().catch(() => ({})) as { sourceChain?: unknown; txHash?: unknown };
  const hasManualInput = input.sourceChain !== undefined || input.txHash !== undefined;
  if (hasManualInput && (!isEvmSource(input.sourceChain) || typeof input.txHash !== "string" || !TX_HASH.test(input.txHash))) {
    return NextResponse.json({ error: "Choose the source chain and enter a valid 0x transaction hash" }, { status: 400 });
  }

  const discoveredByChain = hasManualInput ? [] : await Promise.all(EVM_SOURCES.map(async (chain) => ({ chain, result: await discoverTransactions(current.walletAddress as string, chain) })));
  const candidates: Candidate[] = hasManualInput
    ? [{ hash: input.txHash as string, sourceChain: input.sourceChain as Candidate["sourceChain"], createdAt: new Date().toISOString() }]
    : discoveredByChain.flatMap(({ result }) => result.candidates);
  const unavailableChains = discoveredByChain.filter(({ result }) => !result.available).map(({ chain }) => chain);
  const observations = await mapWithConcurrency(candidates, 8, async (candidate) => ({ candidate, message: await queryIris(candidate) }));
  const cctp = observations.filter((observation): observation is { candidate: Candidate; message: IrisMessage } => Boolean(observation.message));
  if (hasManualInput && !cctp.length) {
    return NextResponse.json({ error: "Circle has not indexed a CCTP message for this source transaction. Verify the chain and burn hash, or retry after source confirmation." }, { status: 404 });
  }

  const result = await mutateDatabase((database) => {
    let imported = 0;
    let confirmed = 0;
    for (const { candidate, message } of cctp) {
      if (database.cctpOperations.some((operation) => operation.burnTxHash?.toLowerCase() === candidate.hash.toLowerCase())) continue;
      const body = message.decodedMessage?.decodedMessageBody;
      const recipientAddress = addressFromBytes32(body?.mintRecipient);
      const rawAmount = String(body?.amount ?? "");
      if (!/^\d+$/.test(rawAmount) || !/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) continue;
      const recipient = database.users.find((user) => user.walletAddress?.toLowerCase() === recipientAddress.toLowerCase());
      const source = SOURCE_EXPLORERS[candidate.sourceChain];
      const complete = message.forwardState === "COMPLETE" && Boolean(message.forwardTxHash && TX_HASH.test(message.forwardTxHash));
      const failed = message.forwardState === "FAILED";
      const now = new Date().toISOString();
      const operation: StoredCctpOperation = {
        id: randomUUID(), ownerId: current.id, recipientUserId: recipient?.id ?? null,
        recipientAddress, recipientLabel: recipient?.displayName ?? `Recovered · ${recipientAddress.slice(0, 8)}…${recipientAddress.slice(-4)}`,
        amount: formatUsdc(BigInt(rawAmount)), sourceChain: candidate.sourceChain,
        sourceDomain: CCTP_TESTNET_DOMAINS[candidate.sourceChain],
        status: failed ? "failed" : complete ? "confirmed" : message.status === "complete" ? "minting" : "attesting",
        burnTxHash: candidate.hash, burnExplorerUrl: `${source.web}/${candidate.hash}`,
        mintTxHash: complete ? message.forwardTxHash as string : null,
        mintExplorerUrl: complete ? `https://testnet.arcscan.app/tx/${message.forwardTxHash}` : null,
        bridgeSteps: [
          { name: "Source burn discovered", txHash: candidate.hash, explorerUrl: `${source.web}/${candidate.hash}` },
          ...(message.status === "complete" ? [{ name: "Circle attestation complete" }] : []),
          ...(complete ? [{ name: "Arc mint confirmed", txHash: message.forwardTxHash as string, explorerUrl: `https://testnet.arcscan.app/tx/${message.forwardTxHash}` }] : []),
        ],
        memo: "Recovered from connected wallet", paymentSessionId: null, invoiceId: null,
        errorMessage: failed ? "Circle Forwarder reported a failed destination mint" : message.status === "complete" && !complete ? "Attestation is ready, but Circle has not reported a completed Arc mint yet" : null,
        createdAt: candidate.createdAt, updatedAt: now,
      };
      database.cctpOperations.push(operation);
      if (complete) {
        finalizeRecovered(database, operation);
        confirmed += 1;
      }
      imported += 1;
    }
    const operations = database.cctpOperations.filter((operation) => operation.ownerId === current.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { imported, confirmed, discovered: candidates.length, unavailableChains, operations };
  });
  return NextResponse.json(result);
}
