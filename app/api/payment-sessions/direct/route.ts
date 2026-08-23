import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { CIRCLE_MINT_SANDBOX_WIRE_MINIMUM } from "@/lib/server/circle-mint";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { createInviteToken, hashInviteToken } from "@/lib/payment-session-security";
import { sessionView } from "@/lib/server/payment-sessions";
import { mutateDatabase, queryDatabase, type StoredPaymentSession } from "@/lib/server/store";

function maximumSandboxAmount() {
  return parseUsdc(process.env.PAYMENT_SESSION_SANDBOX_MAX_USD?.trim() || "10");
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json() as {
      recipientUserId?: string;
      recipientAddress?: string;
      amount?: string;
      memo?: string;
    };
    const amount = parseUsdc(String(body.amount ?? ""));
    if (amount < CIRCLE_MINT_SANDBOX_WIRE_MINIMUM) throw new Error("Circle Mint sandbox bank payments require at least 2.00 USD");
    if (amount > maximumSandboxAmount()) throw new Error(`Sandbox payments are limited to ${formatUsdc(maximumSandboxAmount())} USD`);
    if (!body.recipientUserId) throw new Error("Choose a registered OffGrid recipient");

    const recipient = await queryDatabase((database) => database.users.find((user) => user.id === body.recipientUserId) ?? null);
    if (!recipient || recipient.id === current.id) throw new Error("Choose another registered OffGrid user");
    if (!recipient.walletAddress || !isAddress(recipient.walletAddress)) throw new Error("The recipient must connect and bind an Arc Testnet wallet");
    if (body.recipientAddress && recipient.walletAddress.toLowerCase() !== body.recipientAddress.toLowerCase()) {
      throw new Error("The selected recipient wallet has changed. Select the recipient again");
    }

    const token = createInviteToken();
    const now = new Date();
    const session: StoredPaymentSession = {
      id: randomUUID(),
      inviteTokenHash: hashInviteToken(token),
      inviteToken: token,
      creatorId: current.id,
      counterpartyId: recipient.id,
      creatorIntent: "pay",
      creatorRail: "fiat_bank",
      counterpartyRail: "web3_usdc",
      payerInputRail: "fiat_bank",
      receiverOutputRail: "web3_usdc",
      payerRailStatus: "terms_locked",
      receiverRailStatus: "destination_set",
      clearingStatus: "awaiting_payer",
      arcEscrowTxHash: null,
      auditProof: {
        sessionId: randomUUID(),
        createdAt: now.toISOString(),
        network: "Arc Testnet",
        entryPoint: "dashboard_fiat_to_web3",
        recipientWalletAddress: recipient.walletAddress,
      },
      amount: formatUsdc(amount),
      currency: "USD",
      memo: String(body.memo ?? "").trim().slice(0, 180),
      status: "ready",
      invoiceId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    };

    const view = await mutateDatabase((database) => {
      database.paymentSessions.push(session);
      return sessionView(session, database.users, current.id);
    });
    return NextResponse.json({ session: view, settlementToken: token }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to prepare fiat to Web3 payment" }, { status: 400 });
  }
}
