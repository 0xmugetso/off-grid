import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { parseUsdc, formatUsdc } from "@/lib/money";
import { hashInviteToken, paymentParties } from "@/lib/payment-session-security";
import { createCircleMintSandboxPayout, getCircleMintSandboxPayout } from "@/lib/server/circle-mint";
import { mutateDatabase, queryDatabase, type StoredFiatPayout } from "@/lib/server/store";

function resolveReference(reference: string, fallback: string) {
  const cleaned = reference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 21);
  if (cleaned) return cleaned;
  return fallback.replace(/[^A-Za-z0-9-]/g, "").slice(0, 21) || "OFFGRID";
}

function mapPayoutStatus(status?: string): StoredFiatPayout["status"] {
  if (status === "complete") return "confirmed";
  if (status === "failed") return "failed";
  if (status === "pending") return "pending";
  return "submitted";
}

async function refreshPayouts(ownerId: string) {
  const payouts = await queryDatabase((database) => database.fiatPayouts
    .filter((entry) => entry.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const observations = await Promise.allSettled(payouts.map(async (payout) => {
    if (!payout.circlePayoutId) return null;
    const response = await getCircleMintSandboxPayout(payout.circlePayoutId);
    return { payout, response };
  }));
  return mutateDatabase((database) => {
    for (const observation of observations) {
      if (observation.status !== "fulfilled" || !observation.value) continue;
      const { payout, response } = observation.value;
      const target = database.fiatPayouts.find((entry) => entry.id === payout.id && entry.ownerId === ownerId);
      if (!target) continue;
      const data = response.data;
      if (data?.status) target.status = mapPayoutStatus(data.status);
      if (typeof data?.trackingRef === "string") target.trackingRef = data.trackingRef;
      if (typeof data?.errorCode === "string") target.errorCode = data.errorCode;
      if (typeof data?.destination?.name === "string") target.destinationName = data.destination.name;
      if (typeof data?.sourceWalletId === "string") target.sourceWalletId = data.sourceWalletId;
      target.updatedAt = new Date().toISOString();
      if (target.status === "confirmed" && target.paymentSessionId) {
        const session = database.paymentSessions.find((entry) => entry.id === target.paymentSessionId);
        if (session) {
          session.status = "complete";
          session.clearingStatus = "settled";
          session.receiverRailStatus = "settled";
          session.updatedAt = target.updatedAt;
        }
      }
    }
    return database.fiatPayouts.filter((entry) => entry.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payouts = await refreshPayouts(current.id);
    return NextResponse.json({ payouts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load fiat payouts" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const bankAccountId = process.env.CIRCLE_MINT_BANK_ACCOUNT_ID?.trim();
    if (!bankAccountId) throw new Error("Circle Mint wire bank account is not configured");

    const body = await request.json() as {
      amount?: string;
      reference?: string;
      paymentSessionToken?: string;
    };
    const amount = String(body.amount ?? "").trim();
    if (parseUsdc(amount) <= 0n) throw new Error("Amount must be greater than zero");

    let paymentSessionId: string | null = null;
    let sessionReference = String(body.reference ?? "").trim();
    if (body.paymentSessionToken) {
      const token = String(body.paymentSessionToken);
      const session = await queryDatabase((database) => database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(token)) ?? null);
      if (!session) throw new Error("Payment session not found");
      if (session.status !== "ready" && session.status !== "complete") throw new Error("Payment session is not ready");
      const parties = paymentParties(session);
      if (current.id !== parties.payerId && current.id !== parties.receiverId) throw new Error("Only a session participant can create this payout");
      if (parties.receiverRail !== "fiat_bank") throw new Error("This payment session does not have a bank payout destination");
      if (session.auditProof?.circleMintDepositStatus !== "confirmed") throw new Error("Circle Mint has not confirmed the source deposit for this session");
      if (parseUsdc(session.amount) !== parseUsdc(amount)) throw new Error("Amount does not match the payment session");
      paymentSessionId = session.id;
      sessionReference = sessionReference || session.memo || `SESSION-${session.id.slice(0, 8)}`;
      if (session.receiverBankDetails?.ibanOrAccountNumber) {
        sessionReference = `${sessionReference}-${session.receiverBankDetails.ibanOrAccountNumber.slice(-6)}`;
      }
      const existingPayout = await queryDatabase((database) => database.fiatPayouts.some((entry) => entry.paymentSessionId === session.id && entry.status !== "failed"));
      if (existingPayout) throw new Error("This payment session already has a bank payout in progress");
    }

    const reference = resolveReference(sessionReference, `OFFGRID-${randomUUID().slice(0, 8)}`);
    const payout = await createCircleMintSandboxPayout({
      idempotencyKey: randomUUID(),
      bankAccountId,
      amount: formatUsdc(parseUsdc(amount)),
      reference,
    });
    const data = payout.data ?? {};
    const now = new Date().toISOString();
    const stored: StoredFiatPayout = {
      id: randomUUID(),
      ownerId: current.id,
      paymentSessionId,
      circlePayoutId: typeof data.id === "string" ? data.id : null,
      bankAccountId,
      amount: formatUsdc(parseUsdc(amount)),
      currency: "USD",
      reference,
      status: mapPayoutStatus(data.status),
      trackingRef: typeof data.trackingRef === "string" ? data.trackingRef : null,
      destinationName: typeof data.destination?.name === "string" ? data.destination.name : null,
      sourceWalletId: typeof data.sourceWalletId === "string" ? data.sourceWalletId : null,
      errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    await mutateDatabase((database) => {
      database.fiatPayouts.push(stored);
      if (paymentSessionId) {
        const session = database.paymentSessions.find((entry) => entry.id === paymentSessionId);
        if (session && session.status === "ready") {
          session.clearingStatus = "clearing_on_arc";
          session.receiverRailStatus = "payout_dispatching";
          session.updatedAt = now;
        }
      }
    });
    return NextResponse.json({ payout: stored }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create fiat payout" }, { status: 400 });
  }
}
