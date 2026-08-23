import "server-only";

import { randomUUID } from "node:crypto";
import { parseUsdc } from "@/lib/money";

export interface CircleMintPayoutInput {
  idempotencyKey: string;
  bankAccountId: string;
  amount: string;
  reference: string;
}

export interface CircleMintPayoutRecord {
  code?: number;
  message?: string;
  data?: {
    id?: string;
    sourceWalletId?: string;
    destination?: { type?: string; id?: string; name?: string };
    amount?: { amount?: string; currency?: string };
    toAmount?: { amount?: string; currency?: string };
    fees?: { amount?: string; currency?: string };
    status?: string;
    trackingRef?: string;
    errorCode?: string;
    createDate?: string;
    updateDate?: string;
    customerExternalRef?: string;
  };
}

export interface CircleMintWireInstructions {
  data?: {
    trackingRef?: string;
    beneficiaryBank?: { accountNumber?: string; routingNumber?: string; name?: string };
    beneficiary?: { name?: string };
  };
}

export interface CircleMintMockWirePayment {
  data?: {
    trackingRef?: string;
    amount?: { amount?: string; currency?: string };
    beneficiaryBank?: { accountNumber?: string };
    status?: string;
  };
}

export interface CircleMintTransferRecord {
  code?: number;
  message?: string;
  data?: {
    id?: string;
    status?: string;
    transactionHash?: string;
    errorCode?: string;
    createDate?: string;
    updateDate?: string;
    source?: { type?: string; id?: string };
    destination?: { type?: string; id?: string; address?: string; chain?: string };
    amount?: { amount?: string; currency?: string };
  };
}

export interface CircleMintDepositAddress {
  id?: string;
  address?: string;
  currency?: string;
  chain?: string;
  walletId?: string;
}

export interface CircleMintDepositRecord {
  id?: string;
  destination?: { type?: string; id?: string };
  amount?: { amount?: string; currency?: string };
  status?: string;
  riskEvaluation?: { decision?: string; reason?: string };
  customerExternalRef?: string;
  createDate?: string;
  updateDate?: string;
  source?: { type?: string; id?: string; name?: string };
  fromAmount?: { amount?: string; currency?: string };
  fees?: { amount?: string; currency?: string };
  externalRef?: string;
  trackingRef?: string;
}

const sandboxBaseUrl = "https://api-sandbox.circle.com";
export const CIRCLE_MINT_SANDBOX_WIRE_MINIMUM = parseUsdc("2.00");

function apiKey() {
  const value = process.env.CIRCLE_MINT_API_KEY?.trim();
  if (!value) throw new Error("Circle Mint sandbox API key is not configured");
  return value;
}

export async function getOrCreateCircleMintArcDepositAddress() {
  const base = process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl;
  const headers = { authorization: `Bearer ${apiKey()}` };
  const listResponse = await fetch(`${base}/v1/businessAccount/wallets/addresses/deposit`, { headers, cache: "no-store" });
  const listBody = await listResponse.json() as { code?: number; message?: string; data?: CircleMintDepositAddress[] };
  if (!listResponse.ok) throw mintError("Circle Mint deposit address lookup", listResponse, listBody);
  const existing = listBody.data?.find((entry) => entry.chain === "ARC" && entry.currency === "USD" && entry.address);
  if (existing) return existing;
  const createResponse = await fetch(`${base}/v1/businessAccount/wallets/addresses/deposit`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), currency: "USD", chain: "ARC" }),
  });
  const createBody = await createResponse.json() as { code?: number; message?: string; data?: CircleMintDepositAddress };
  if (!createResponse.ok) throw mintError("Circle Mint Arc deposit address creation", createResponse, createBody);
  if (!createBody.data?.id || !createBody.data.address) throw new Error("Circle Mint did not return an Arc deposit address");
  return createBody.data;
}

export async function findCircleMintInboundTransfer(input: { txHash: string; amount: string; submittedAfter: string }) {
  const query = new URLSearchParams({ pageSize: "50", from: input.submittedAfter });
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/transfers?${query}`, {
    headers: { authorization: `Bearer ${apiKey()}` }, cache: "no-store",
  });
  const body = await response.json() as { code?: number; message?: string; data?: NonNullable<CircleMintTransferRecord["data"]>[] };
  if (!response.ok) throw mintError("Circle Mint inbound transfer lookup", response, body);
  return body.data?.find((entry) => {
    if (entry.transactionHash?.toLowerCase() !== input.txHash.toLowerCase()) return false;
    if (!entry.amount?.amount || entry.amount.currency !== "USD") return false;
    try { return parseUsdc(entry.amount.amount) === parseUsdc(input.amount); } catch { return false; }
  }) ?? null;
}

export function circleMintSandboxStatus() {
  const checks = [
    { key: "apiKey", label: "Circle Mint sandbox API key", configured: Boolean(process.env.CIRCLE_MINT_API_KEY) },
    { key: "bankAccount", label: "Sandbox linked wire bank account ID", configured: Boolean(process.env.CIRCLE_MINT_BANK_ACCOUNT_ID) },
    { key: "settlementWallet", label: "Developer settlement wallet", configured: Boolean(
      process.env.CIRCLE_API_KEY
      && process.env.CIRCLE_ENTITY_SECRET
      && (process.env.CIRCLE_SETTLEMENT_WALLET_ID || process.env.CIRCLE_ESCROW_AGENT_WALLET_ID)
      && (process.env.CIRCLE_SETTLEMENT_WALLET_ADDRESS || process.env.CIRCLE_ESCROW_AGENT_ADDRESS)
    ) },
    { key: "webhook", label: "HTTPS webhook verification secret", configured: Boolean(process.env.PAYOUT_WEBHOOK_SECRET) },
  ];
  return {
    provider: "circle_mint_sandbox" as const,
    mode: "sandbox" as const,
    configured: checks.slice(0, 3).every((check) => check.configured),
    checks,
    baseUrl: process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl,
    simulated: true,
  };
}

export async function listCircleMintWireDeposits(input?: { from?: string; pageSize?: number }) {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const query = new URLSearchParams({ type: "wire", pageSize: String(input?.pageSize ?? 50) });
  if (input?.from) query.set("from", input.from);
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/deposits?${query}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  const body = await response.json() as { code?: number; message?: string; data?: CircleMintDepositRecord[] };
  if (!response.ok) throw mintError("Circle Mint deposit lookup", response, body);
  return body.data ?? [];
}

export async function findCircleMintWireDeposit(input: {
  trackingRef: string;
  amount: string;
  submittedAfter: string;
  excludedIds?: string[];
}) {
  const deposits = await listCircleMintWireDeposits({ from: input.submittedAfter, pageSize: 50 });
  const excluded = new Set(input.excludedIds ?? []);
  return deposits.find((deposit) => {
    if (!deposit.id || excluded.has(deposit.id)) return false;
    if (deposit.trackingRef !== input.trackingRef || deposit.amount?.currency !== "USD" || !deposit.amount.amount) return false;
    try {
      return parseUsdc(deposit.amount.amount) === parseUsdc(input.amount);
    } catch {
      return false;
    }
  }) ?? null;
}

function mintError(operation: string, response: Response, data: { code?: number; message?: string }) {
  return new Error(`${operation} failed with HTTP ${response.status}${typeof data.code === "number" ? ` (${data.code})` : ""}${data.message ? `: ${data.message}` : ""}`);
}

export async function createCircleMintOnchainTransfer(input: {
  idempotencyKey: string;
  recipientAddressId: string;
  amount: string;
  reference: string;
}) {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/transfers`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      destination: { type: "blockchain", addressId: input.recipientAddressId },
      amount: { amount: input.amount, currency: "USD" },
      customerExternalRef: input.reference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 21),
    }),
  });
  const data = await response.json() as CircleMintTransferRecord;
  if (!response.ok) throw mintError("Circle Mint onchain transfer", response, data);
  return data;
}

export async function getCircleMintOnchainTransfer(transferId: string) {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/transfers/${encodeURIComponent(transferId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json() as CircleMintTransferRecord;
  if (!response.ok) throw mintError("Circle Mint transfer lookup", response, data);
  return data;
}

export interface CircleMintBalancesResponse {
  data?: {
    available?: Array<{ amount?: string; currency?: string }>;
    unallocated?: Array<{ amount?: string; currency?: string }>;
  };
}

export async function fetchCircleMintBalances(): Promise<{ availableUsd: string; unallocatedUsd: string }> {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) {
    return { availableUsd: "0.00", unallocatedUsd: "0.00" };
  }
  try {
    const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/balances`, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return { availableUsd: "0.00", unallocatedUsd: "0.00" };
    }
    const data = (await response.json()) as CircleMintBalancesResponse;
    const availableItem = data.data?.available?.find((item) => item.currency === "USD");
    const unallocatedItem = data.data?.unallocated?.find((item) => item.currency === "USD");
    return {
      availableUsd: availableItem?.amount || "0.00",
      unallocatedUsd: unallocatedItem?.amount || "0.00",
    };
  } catch {
    return { availableUsd: "0.00", unallocatedUsd: "0.00" };
  }
}

/**
 * Server-only Circle Mint redemption call. It is intentionally not exposed as
 * a public route until a confirmed Circle deposit and participant-owned bank
 * account have been attached to the payment session.
 */
export async function createCircleMintSandboxPayout(input: CircleMintPayoutInput): Promise<CircleMintPayoutRecord> {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/payouts`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      destination: { type: "wire", id: input.bankAccountId },
      amount: { amount: input.amount, currency: "USD" },
      customerExternalRef: input.reference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 21),
    }),
  });
  const data = await response.json() as CircleMintPayoutRecord;
  if (!response.ok) throw new Error(`Circle Mint payout request failed with HTTP ${response.status}${typeof data.code === "number" ? ` (${data.code})` : ""}${data.message ? `: ${data.message}` : ""}`);
  return data;
}

export async function getCircleMintSandboxPayout(payoutId: string) {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/payouts/${encodeURIComponent(payoutId)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json() as CircleMintPayoutRecord;
  if (!response.ok) throw new Error(`Circle Mint payout lookup failed with HTTP ${response.status}${typeof data.code === "number" ? ` (${data.code})` : ""}${data.message ? `: ${data.message}` : ""}`);
  return data;
}

export async function getCircleMintSandboxWireInstructions(bankAccountId: string) {
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/businessAccount/banks/wires/${encodeURIComponent(bankAccountId)}/instructions`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json() as CircleMintWireInstructions & { code?: number; message?: string };
  if (!response.ok) throw mintError("Circle Mint wire instructions lookup", response, data);
  return data;
}

export async function createCircleMintSandboxMockWirePayment(input: { bankAccountId: string; amount: string; memo?: string }) {
  if (parseUsdc(input.amount) < CIRCLE_MINT_SANDBOX_WIRE_MINIMUM) {
    throw new Error("Circle Mint sandbox bank payments require at least 2.00 USD. Create a new session for 2.00 USD or more.");
  }
  const instructions = await getCircleMintSandboxWireInstructions(input.bankAccountId);
  const trackingRef = instructions.data?.trackingRef;
  const accountNumber = instructions.data?.beneficiaryBank?.accountNumber;
  const apiKey = process.env.CIRCLE_MINT_API_KEY;
  if (!apiKey) throw new Error("Circle Mint sandbox API key is not configured");
  if (!trackingRef || !accountNumber) throw new Error("Circle Mint wire instructions are incomplete");
  const response = await fetch(`${process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl}/v1/mocks/payments/wire`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      trackingRef,
      amount: { amount: input.amount, currency: "USD" },
      beneficiaryBank: { accountNumber },
      memo: input.memo?.slice(0, 140),
    }),
  });
  const data = await response.json() as CircleMintMockWirePayment & { code?: number; message?: string };
  if (!response.ok) throw mintError("Circle Mint mock wire payment", response, data);
  return data;
}
