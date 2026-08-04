import "server-only";

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

const sandboxBaseUrl = "https://api-sandbox.circle.com";

export function circleMintSandboxStatus() {
  const checks = [
    { key: "apiKey", label: "Circle Mint sandbox API key", configured: Boolean(process.env.CIRCLE_MINT_API_KEY) },
    { key: "bankAccount", label: "Sandbox linked wire bank account ID", configured: Boolean(process.env.CIRCLE_MINT_BANK_ACCOUNT_ID) },
    { key: "webhook", label: "HTTPS webhook verification secret", configured: Boolean(process.env.PAYOUT_WEBHOOK_SECRET) },
  ];
  return {
    provider: "circle_mint_sandbox" as const,
    mode: "sandbox" as const,
    configured: checks.slice(0, 2).every((check) => check.configured),
    checks,
    baseUrl: process.env.CIRCLE_MINT_BASE_URL ?? sandboxBaseUrl,
    simulated: true,
  };
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
  const data = await response.json() as CircleMintWireInstructions;
  if (!response.ok) throw new Error(`Circle Mint wire instructions lookup failed with HTTP ${response.status}`);
  return data;
}

export async function createCircleMintSandboxMockWirePayment(input: { bankAccountId: string; amount: string; memo?: string }) {
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
  const data = await response.json() as CircleMintMockWirePayment;
  if (!response.ok) throw new Error(`Circle Mint mock wire payment failed with HTTP ${response.status}`);
  return data;
}
