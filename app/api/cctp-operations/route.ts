import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { CCTP_SOURCE_CHAINS, CCTP_TESTNET_DOMAINS, type CctpSourceChain } from "@/lib/arc/config";
import { parseUsdc } from "@/lib/money";
import { shouldPruneUnsignedCctpOperation } from "@/lib/cctp-operations";
import { getCurrentUser } from "@/lib/server/auth";
import { hashInviteToken, paymentParties } from "@/lib/payment-session-security";
import { mutateDatabase, queryDatabase, type Database, type StoredCctpOperation, type StoredInvoice } from "@/lib/server/store";
import { EVM_TRANSACTION_HASH, isSourceTransactionHash, isTransactionHash } from "@/lib/transaction-hash";

const TX_HASH = EVM_TRANSACTION_HASH;

type IrisMessage = {
  status?: string;
  forwardState?: "PENDING" | "CONFIRMED" | "COMPLETE" | "FAILED" | null;
  forwardTxHash?: string | null;
  decodedMessage?: {
    destinationDomain?: string | number;
    decodedMessageBody?: { mintRecipient?: string; amount?: string };
  };
};

function cleanSteps(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((entry) => {
    const step = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      name: String(step.name ?? "CCTP step").slice(0, 40),
      txHash: typeof step.txHash === "string" && isTransactionHash(step.txHash) ? step.txHash : undefined,
      explorerUrl: typeof step.explorerUrl === "string" && /^https:\/\//.test(step.explorerUrl) ? step.explorerUrl.slice(0, 300) : undefined,
    };
  });
}

function finalizeOperation(database: Database, operation: StoredCctpOperation) {
  if (operation.invoiceId || !operation.mintTxHash) return;
  const now = new Date().toISOString();
  const invoice: StoredInvoice = {
    id: randomUUID(),
    senderId: operation.ownerId,
    recipientUserId: operation.recipientUserId,
    recipientAddress: operation.recipientAddress,
    recipientLabel: operation.recipientLabel,
    amount: operation.amount,
    token: "USDC",
    fundingMethod: "cctp_bridge",
    sourceChain: operation.sourceChain,
    protocol: "cctp",
    bridgeSteps: operation.bridgeSteps,
    paymentSessionId: operation.paymentSessionId ?? undefined,
    txHash: operation.mintTxHash,
    explorerUrl: operation.mintExplorerUrl ?? `https://testnet.arcscan.app/tx/${operation.mintTxHash}`,
    status: "confirmed",
    memo: operation.memo,
    createdAt: now,
  };
  database.invoices.push(invoice);
  operation.invoiceId = invoice.id;
  operation.status = "confirmed";
  operation.updatedAt = now;
  if (operation.paymentSessionId) {
    const session = database.paymentSessions.find((entry) => entry.id === operation.paymentSessionId);
    if (session && session.status === "ready") {
      session.status = "complete";
      session.invoiceId = invoice.id;
      session.updatedAt = now;
    }
  }
}

function messageMatchesOperation(message: IrisMessage, operation: StoredCctpOperation) {
  const decoded = message.decodedMessage;
  const body = decoded?.decodedMessageBody;
  const recipient = String(body?.mintRecipient ?? "").toLowerCase().replace(/^0x/, "").slice(-40);
  const expectedRecipient = operation.recipientAddress.toLowerCase().replace(/^0x/, "");
  return Number(decoded?.destinationDomain) === 26
    && recipient === expectedRecipient
    && String(body?.amount ?? "") === parseUsdc(operation.amount).toString();
}

async function queryIris(operation: StoredCctpOperation): Promise<IrisMessage | null> {
  if (!operation.burnTxHash) return null;
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${operation.sourceDomain}?transactionHash=${encodeURIComponent(operation.burnTxHash)}`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const payload = await response.json() as { messages?: IrisMessage[] };
    return payload.messages?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pending = await queryDatabase((database) => database.cctpOperations.filter((operation) => operation.ownerId === current.id && operation.burnTxHash && operation.status !== "confirmed" && operation.status !== "failed"));
  const observations = await Promise.all(pending.map(async (operation) => ({ id: operation.id, message: await queryIris(operation) })));
  const operations = await mutateDatabase((database) => {
    // Remove legacy preflight failures and abandoned wallet prompts. These do
    // not have a source-chain burn, so they are attempts rather than transfers.
    database.cctpOperations = database.cctpOperations.filter((operation) => (
      operation.ownerId !== current.id || !shouldPruneUnsignedCctpOperation(operation)
    ));
    for (const observation of observations) {
      if (!observation.message) continue;
      const operation = database.cctpOperations.find((entry) => entry.id === observation.id && entry.ownerId === current.id);
      if (!operation || !messageMatchesOperation(observation.message, operation)) continue;
      if (observation.message.forwardState === "FAILED") {
        operation.status = "failed";
        operation.errorMessage = "Circle Forwarder reported a failed destination mint";
      } else if (observation.message.forwardState === "COMPLETE" && observation.message.forwardTxHash && TX_HASH.test(observation.message.forwardTxHash)) {
        operation.mintTxHash = observation.message.forwardTxHash;
        operation.mintExplorerUrl = `https://testnet.arcscan.app/tx/${observation.message.forwardTxHash}`;
        operation.bridgeSteps = [
          { name: "Burn confirmed", txHash: operation.burnTxHash ?? undefined, explorerUrl: operation.burnExplorerUrl ?? undefined },
          { name: "Circle attestation complete" },
          { name: "Arc mint confirmed", txHash: operation.mintTxHash, explorerUrl: operation.mintExplorerUrl },
        ];
        finalizeOperation(database, operation);
      } else if (observation.message.status === "complete") {
        operation.status = "minting";
      } else {
        operation.status = "attesting";
      }
      operation.updatedAt = new Date().toISOString();
    }
    return database.cctpOperations.filter((operation) => operation.ownerId === current.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  return NextResponse.json({ operations });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const recipientAddress = String(body.recipientAddress ?? "");
    const amount = String(body.amount ?? "");
    const sourceChain = String(body.sourceChain ?? "") as CctpSourceChain;
    if (!isAddress(recipientAddress)) throw new Error("Invalid Arc recipient address");
    if (!CCTP_SOURCE_CHAINS.includes(sourceChain)) throw new Error("Unsupported CCTP source chain");
    if (parseUsdc(amount) <= 0n) throw new Error("Amount must be greater than zero");
    const now = new Date().toISOString();
    const operation: StoredCctpOperation = {
      id: randomUUID(), ownerId: current.id,
      recipientUserId: typeof body.recipientUserId === "string" ? body.recipientUserId : null,
      recipientAddress, recipientLabel: String(body.recipientLabel ?? recipientAddress).slice(0, 80), amount,
      sourceChain, sourceDomain: CCTP_TESTNET_DOMAINS[sourceChain], status: "awaiting_signature",
      burnTxHash: null, burnExplorerUrl: null, mintTxHash: null, mintExplorerUrl: null,
      bridgeSteps: [], memo: String(body.memo ?? "").slice(0, 180), paymentSessionId: null,
      invoiceId: null, errorMessage: null, createdAt: now, updatedAt: now,
    };
    await mutateDatabase((database) => {
      if (typeof body.paymentSessionToken === "string" && body.paymentSessionToken) {
        const session = database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(body.paymentSessionToken as string));
        if (!session || session.status !== "ready") throw new Error("Payment session is not ready");
        const parties = paymentParties(session);
        if (parties.payerId !== current.id) throw new Error("Only the payer can execute this session");
        if (parties.payerRail !== "web3_usdc" || parties.receiverRail !== "web3_usdc") throw new Error("A fiat provider is required for this session");
        const receiver = database.users.find((user) => user.id === parties.receiverId);
        if (!receiver?.walletAddress || receiver.walletAddress.toLowerCase() !== recipientAddress.toLowerCase()) throw new Error("Session recipient does not match");
        if (parseUsdc(session.amount) !== parseUsdc(amount)) throw new Error("Session amount does not match");
        if (database.cctpOperations.some((entry) => entry.paymentSessionId === session.id && entry.status !== "failed")) throw new Error("This payment session already has a CCTP transfer in progress");
        operation.paymentSessionId = session.id;
      }
      database.cctpOperations.push(operation);
    });
    return NextResponse.json({ operation }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create CCTP operation" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const event = String(body.event ?? "");
    const operation = await mutateDatabase((database) => {
      const entry = database.cctpOperations.find((item) => item.id === id && item.ownerId === current.id);
      if (!entry) throw new Error("CCTP operation not found");
      const now = new Date().toISOString();
      if (event === "burn") {
        const txHash = String(body.txHash ?? "");
        if (!isSourceTransactionHash(entry.sourceChain, txHash)) throw new Error("Invalid source burn transaction hash");
        if (entry.burnTxHash && entry.burnTxHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("This CCTP operation already has a different source burn");
        entry.burnTxHash = txHash;
        entry.burnExplorerUrl = typeof body.explorerUrl === "string" && /^https:\/\//.test(body.explorerUrl) ? body.explorerUrl.slice(0, 300) : null;
        if (entry.status !== "confirmed") entry.status = "attesting";
        entry.errorMessage = null;
      } else if (event === "mint_submitted") {
        const txHash = String(body.txHash ?? "");
        if (!TX_HASH.test(txHash)) throw new Error("Invalid Arc mint transaction hash");
        entry.mintTxHash = txHash;
        entry.mintExplorerUrl = `https://testnet.arcscan.app/tx/${txHash}`;
        entry.bridgeSteps = cleanSteps(body.bridgeSteps);
        entry.status = "minting";
      } else if (event === "failed") {
        entry.errorMessage = String(body.errorMessage ?? "CCTP operation failed").slice(0, 240);
        if (!entry.burnTxHash) entry.status = "failed";
      } else throw new Error("Unsupported operation update");
      entry.updatedAt = now;
      return entry;
    });
    return NextResponse.json({ operation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update CCTP operation" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    await mutateDatabase((database) => {
      const index = database.cctpOperations.findIndex((operation) => operation.id === id && operation.ownerId === current.id);
      if (index < 0) return;
      if (database.cctpOperations[index].burnTxHash) throw new Error("A submitted CCTP transfer cannot be discarded");
      database.cctpOperations.splice(index, 1);
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to discard CCTP attempt" }, { status: 400 });
  }
}
