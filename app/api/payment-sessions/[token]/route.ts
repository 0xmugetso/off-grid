import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { hashInviteToken } from "@/lib/payment-session-security";
import { sessionView } from "@/lib/server/payment-sessions";
import { mutateDatabase, queryDatabase, type PaymentRail } from "@/lib/server/store";

function validToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ error: "Payment session not found" }, { status: 404 });
  const result = await queryDatabase((database) => {
    const session = database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(token) || entry.inviteTokenHash === token);
    if (!session) return { status: 404, error: "Payment session not found" };
    if (session.counterpartyId && current.id !== session.creatorId && current.id !== session.counterpartyId) return { status: 403, error: "This invite has already been claimed" };
    return { status: 200, session: sessionView(session, database.users, current.id) };
  });
  return "session" in result ? NextResponse.json({ session: result.session }) : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ error: "Payment session not found" }, { status: 404 });
  try {
    const body = await request.json() as {
      action?: string;
      rail?: string;
      receiverBankDetails?: {
        accountHolderName?: string;
        ibanOrAccountNumber?: string;
        routingOrSwift?: string;
        bankCountry?: string;
      };
    };
    const view = await mutateDatabase((database) => {
      const session = database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(token) || entry.inviteTokenHash === token);
      if (!session) throw new Error("Payment session not found");
      if (new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("This payment invite has expired");
      if (session.status === "complete") throw new Error("This payment is already complete");

      if (body.action === "archive" || body.action === "cancel") {
        if (current.id !== session.creatorId && current.id !== session.counterpartyId) {
          throw new Error("Only participants can archive this session");
        }
        session.status = "archived";
      } else if (body.action === "respond") {
        if (current.id === session.creatorId) throw new Error("Share this invite with the other participant");
        if (session.counterpartyId && session.counterpartyId !== current.id) throw new Error("This invite has already been claimed");
        if (body.rail !== "web3_usdc" && body.rail !== "fiat_bank") throw new Error("Choose a payment rail");
        if (body.rail === "web3_usdc" && !current.walletAddress) throw new Error("Connect and bind your wallet before choosing Web3 USDC");
        session.counterpartyId = current.id;
        session.counterpartyRail = body.rail as PaymentRail;
        if (session.creatorIntent === "pay") {
          session.receiverOutputRail = body.rail;
          session.receiverRailStatus = "terms_locked";
        } else {
          session.payerInputRail = body.rail;
          session.payerRailStatus = "terms_locked";
        }
        if (body.rail === "fiat_bank" && body.receiverBankDetails) {
          session.receiverBankDetails = {
            accountHolderName: String(body.receiverBankDetails.accountHolderName ?? "").trim(),
            ibanOrAccountNumber: String(body.receiverBankDetails.ibanOrAccountNumber ?? "").trim(),
            routingOrSwift: String(body.receiverBankDetails.routingOrSwift ?? "").trim(),
            bankCountry: String(body.receiverBankDetails.bankCountry ?? "US").trim(),
          };
        }
        session.status = "ready";
      } else {
        throw new Error("Unsupported session action");
      }
      session.updatedAt = new Date().toISOString();
      return sessionView(session, database.users, current.id);
    });
    return NextResponse.json({ session: view });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update payment session";
    const status = message.includes("not found") ? 404 : message.includes("already been claimed") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
