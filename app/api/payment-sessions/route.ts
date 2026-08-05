import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { createInviteToken, hashInviteToken } from "@/lib/payment-session-security";
import { sessionView } from "@/lib/server/payment-sessions";
import { mutateDatabase, queryDatabase, type PaymentRail, type StoredPaymentSession } from "@/lib/server/store";
import { formatUsdc, parseUsdc } from "@/lib/money";

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (body.rail === "web3_usdc" && !current.walletAddress) throw new Error("Connect and bind your wallet before choosing Web3 USDC");

    const token = createInviteToken();
    const now = new Date();

    const isPayer = body.intent === "pay";
    const session: StoredPaymentSession = {
      id: randomUUID(),
      inviteTokenHash: hashInviteToken(token),
      creatorId: current.id,
      counterpartyId: null,
      creatorIntent: body.intent,
      creatorRail: body.rail as PaymentRail,
      counterpartyRail: null,
      payerInputRail: isPayer ? "card_moonpay" : null,
      receiverOutputRail: !isPayer ? "fiat_bank_ach" : null,
      payerRailStatus: isPayer ? "pending_selection" : "pending_selection",
      receiverRailStatus: !isPayer ? "destination_set" : "pending_selection",
      clearingStatus: "created",
      arcEscrowTxHash: null,
      auditProof: {
        sessionId: randomUUID(),
        createdAt: now.toISOString(),
        network: "Arc Testnet (~0.48s finality)",
      },
      amount: formatUsdc(parsedAmount),
      currency: "USD",
      memo: String(body.memo ?? "").trim().slice(0, 180),
      status: "open",
      invoiceId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
