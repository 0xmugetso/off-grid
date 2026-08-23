import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { CCTP_TESTNET_DOMAINS, SOURCE_CHAINS, type SourceChain } from "@/lib/arc/config";
import { parseUsdc } from "@/lib/money";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase, queryDatabase, type StoredGatewayDeposit } from "@/lib/server/store";

const GATEWAY_API = "https://gateway-api-testnet.circle.com";
const GATEWAY_WALLET = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const EVM_TX = /^0x[a-fA-F0-9]{64}$/;
const SOLANA_TX = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const RPC_URLS: Partial<Record<SourceChain, string[]>> = {
  Base_Sepolia: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  Arbitrum_Sepolia: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
  Ethereum_Sepolia: ["https://rpc.sepolia.org", "https://ethereum-sepolia-rpc.publicnode.com"],
  Arc_Testnet: ["https://rpc.testnet.arc.io", "https://rpc.testnet.arc.network"],
};

type GatewayDepositObservation = {
  transactionHash?: string;
  status?: string;
};

async function gatewaySnapshot(operations: StoredGatewayDeposit[]) {
  const sources = [...new Map(operations.map((operation) => [
    `${operation.sourceDomain}:${operation.sourceAddress.toLowerCase()}`,
    { depositor: operation.sourceAddress, domain: operation.sourceDomain },
  ])).values()];
  if (!sources.length) return { balances: [] as Array<{ domain: number; depositor: string; balance: string }>, deposits: [] as GatewayDepositObservation[] };
  const body = JSON.stringify({ token: "USDC", sources });
  const [balanceResponse, depositResponse] = await Promise.all([
    fetch(`${GATEWAY_API}/v1/balances`, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(8_000) }),
    fetch(`${GATEWAY_API}/v1/deposits`, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(8_000) }),
  ]);
  const balancePayload = balanceResponse.ok ? await balanceResponse.json() as { balances?: Array<{ domain: number; depositor: string; balance: string }> } : {};
  const depositPayload = depositResponse.ok ? await depositResponse.json() as { deposits?: GatewayDepositObservation[] } : {};
  return { balances: balancePayload.balances ?? [], deposits: depositPayload.deposits ?? [] };
}

async function rpc(chain: SourceChain, method: string, params: unknown[]) {
  for (const url of RPC_URLS[chain] ?? []) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as { result?: unknown; error?: unknown };
      if (!payload.error && payload.result != null) return payload.result;
    } catch {
      // Try the next chain-specific public endpoint.
    }
  }
  return null;
}

async function evmReceipt(operation: StoredGatewayDeposit) {
  if (operation.sourceChain === "Solana_Devnet" || !EVM_TX.test(operation.txHash)) return null;
  return await rpc(operation.sourceChain as SourceChain, "eth_getTransactionReceipt", [operation.txHash]) as null | {
    status?: string;
    to?: string;
    blockNumber?: string;
  };
}

function balanceFor(operation: StoredGatewayDeposit, balances: Array<{ domain: number; depositor: string; balance: string }>) {
  return balances.find((entry) => entry.domain === operation.sourceDomain && entry.depositor.toLowerCase() === operation.sourceAddress.toLowerCase())?.balance ?? null;
}

async function reconcile(ownerId: string) {
  const active = await queryDatabase((database) => database.gatewayDeposits.filter((operation) => operation.ownerId === ownerId && operation.status !== "confirmed" && operation.status !== "failed"));
  let snapshot: Awaited<ReturnType<typeof gatewaySnapshot>> = { balances: [], deposits: [] };
  try { snapshot = await gatewaySnapshot(active); } catch { /* Existing proof remains visible during provider outages. */ }
  const receipts = await Promise.all(active.map(async (operation) => ({ id: operation.id, receipt: await evmReceipt(operation) })));
  return mutateDatabase((database) => {
    const now = new Date().toISOString();
    for (const observation of receipts) {
      const operation = database.gatewayDeposits.find((entry) => entry.id === observation.id && entry.ownerId === ownerId);
      if (!operation) continue;
      const receipt = observation.receipt;
      if (receipt?.status === "0x0") {
        operation.status = "failed";
        operation.errorMessage = "The source-chain Gateway deposit reverted.";
      } else if (receipt?.status === "0x1") {
        if (receipt.to?.toLowerCase() !== GATEWAY_WALLET) {
          operation.status = "failed";
          operation.errorMessage = "This transaction did not call Circle's testnet Gateway Wallet.";
        } else {
          operation.sourceBlockNumber = receipt.blockNumber ?? operation.sourceBlockNumber;
          operation.sourceConfirmedAt ??= now;
          operation.status = "source_confirmed";
          operation.errorMessage = null;
        }
      }
      const pending = snapshot.deposits.some((entry) => entry.transactionHash?.toLowerCase() === operation.txHash.toLowerCase());
      if (pending) {
        operation.gatewayPendingObserved = true;
        operation.status = "indexing";
      }
      const observedBalance = balanceFor(operation, snapshot.balances);
      if (observedBalance != null) operation.observedGatewayBalance = observedBalance;
      if (operation.expectedConfirmed != null && observedBalance != null && Number(observedBalance) + 0.000001 >= Number(operation.expectedConfirmed)) {
        operation.status = "confirmed";
        operation.errorMessage = null;
      }
      operation.updatedAt = now;
    }
    return database.gatewayDeposits.filter((operation) => operation.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ deposits: await reconcile(current.id) });
  } catch {
    const deposits = await queryDatabase((database) => database.gatewayDeposits.filter((operation) => operation.ownerId === current.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return NextResponse.json({ deposits, providerReadAvailable: false });
  }
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const sourceChain = String(body.sourceChain ?? "") as SourceChain;
    if (!SOURCE_CHAINS.includes(sourceChain)) throw new Error("Unsupported Gateway source chain");
    const sourceAddress = String(body.sourceAddress ?? "");
    if (sourceChain === "Solana_Devnet" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sourceAddress) : !isAddress(sourceAddress)) throw new Error("Invalid source wallet address");
    const txHash = String(body.txHash ?? "");
    if (sourceChain === "Solana_Devnet" ? !SOLANA_TX.test(txHash) : !EVM_TX.test(txHash)) throw new Error("Invalid source transaction hash");
    const amount = String(body.amount ?? "");
    if (parseUsdc(amount) <= 0n) throw new Error("Deposit amount must be greater than zero");
    const confirmedBefore = body.confirmedBefore == null ? null : String(body.confirmedBefore);
    if (confirmedBefore != null && (!Number.isFinite(Number(confirmedBefore)) || Number(confirmedBefore) < 0)) throw new Error("Invalid starting Gateway balance");
    const explorerUrl = typeof body.explorerUrl === "string" && /^https:\/\//.test(body.explorerUrl) ? body.explorerUrl.slice(0, 300) : null;
    const deposit = await mutateDatabase((database) => {
      const existing = database.gatewayDeposits.find((entry) => entry.ownerId === current.id && entry.txHash.toLowerCase() === txHash.toLowerCase());
      if (existing) return existing;
      const queuedTarget = database.gatewayDeposits
        .filter((entry) => entry.ownerId === current.id && entry.sourceDomain === CCTP_TESTNET_DOMAINS[sourceChain] && entry.sourceAddress.toLowerCase() === sourceAddress.toLowerCase() && entry.status !== "failed")
        .reduce((highest, entry) => Math.max(highest, Number(entry.expectedConfirmed ?? 0)), 0);
      const baseline = confirmedBefore == null ? null : Math.max(Number(confirmedBefore), queuedTarget);
      const expectedConfirmed = baseline == null ? null : (baseline + Number(amount)).toFixed(6);
      const now = new Date().toISOString();
      const entry: StoredGatewayDeposit = {
        id: randomUUID(), ownerId: current.id, sourceAddress, sourceChain,
        sourceDomain: CCTP_TESTNET_DOMAINS[sourceChain], amount, txHash, explorerUrl,
        status: "submitted", confirmedBefore, expectedConfirmed,
        observedGatewayBalance: null, sourceBlockNumber: null, sourceConfirmedAt: null,
        gatewayPendingObserved: false, errorMessage: null, createdAt: now, updatedAt: now,
      };
      database.gatewayDeposits.push(entry);
      return entry;
    });
    return NextResponse.json({ deposit }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to track Gateway deposit" }, { status: 400 });
  }
}
