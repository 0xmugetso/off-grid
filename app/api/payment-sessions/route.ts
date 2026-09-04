import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { createInviteToken, hashInviteToken } from "@/lib/payment-session-security";
import { sessionView } from "@/lib/server/payment-sessions";
import { mutateDatabase, queryDatabase, type PaymentRail, type StoredPaymentSession } from "@/lib/server/store";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { CIRCLE_MINT_SANDBOX_WIRE_MINIMUM } from "@/lib/server/circle-mint";

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await mutateDatabase((database) => {
    const now = Date.now();
    for (const session of database.paymentSessions) {
      const stale = (session.status === "open" || session.status === "ready") && (new Date(session.expiresAt).getTime() <= now || now - new Date(session.createdAt).getTime() > 24 * 60 * 60 * 1000);
      if (stale) { session.status = "expired"; session.updatedAt = new Date().toISOString(); }
    }
    return null;
  });
  const sessions = await queryDatabase((database) => database.paymentSessions
    .filter((session) => session.creatorId === current.id || session.counterpartyId === current.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((session) => sessionView(session, database.users, current.id)));
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { intent?: string; rail?: string; amount?: string; memo?: string };
    if (body.intent !== "pay" && body.intent !== "receive") throw new Error("Choose whether you want to pay or receive");
    if (body.rail !== "web3_usdc" && body.rail !== "fiat_bank") throw new Error("Choose a payment rail");
    const parsedAmount = parseUsdc(String(body.amount ?? ""));
    if (parsedAmount <= 0n) throw new Error("Amount must be greater than zero");
    if (body.intent === "pay" && body.rail === "fiat_bank" && parsedAmount <= CIRCLE_MINT_SANDBOX_WIRE_MINIMUM) {
      throw new Error("Circle Mint sandbox bank payments must be greater than 2.00 USD");
    }
    if (body.rail === "web3_usdc" && !current.walletAddress) throw new Error("Connect and bind your wallet before choosing Web3 USDC");

    const token = createInviteToken();
    const now = new Date();

    const isPayer = body.intent === "pay";
    const session: StoredPaymentSession = {
      id: randomUUID(),
      inviteTokenHash: hashInviteToken(token),
      inviteToken: token,
      creatorId: current.id,
      counterpartyId: null,
      creatorIntent: body.intent,
      creatorRail: body.rail as PaymentRail,
      counterpartyRail: null,
      payerInputRail: isPayer ? body.rail : null,
      receiverOutputRail: !isPayer ? body.rail : null,
      payerRailStatus: isPayer ? "terms_locked" : "pending_selection",
      receiverRailStatus: !isPayer ? "terms_locked" : "pending_selection",
      clearingStatus: "created",
      arcEscrowTxHash: null,
      auditProof: {
        sessionId: randomUUID(),
        createdAt: now.toISOString(),
        network: "Arc Testnet",
      },
      amount: formatUsdc(parsedAmount),
      currency: "USD",
      memo: String(body.memo ?? "").trim().slice(0, 180),
      status: "open",
      invoiceId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    };
    const view = await mutateDatabase((database) => {
      database.paymentSessions.push(session);
      return sessionView(session, database.users, current.id);
    });
    return NextResponse.json({ session: view, inviteToken: token }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create payment session" }, { status: 400 });
  }
}
