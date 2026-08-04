import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { hashInviteToken, paymentParties } from "@/lib/payment-session-security";
import { mutateDatabase, queryDatabase, type StoredInvoice } from "@/lib/server/store";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { isTransactionHash } from "@/lib/transaction-hash";

function addUsdc(balance: string, delta: bigint) {
  return formatUsdc(parseUsdc(balance) + delta);
}

function subtractUsdc(balance: string, delta: bigint) {
  const current = parseUsdc(balance);
  if (current < delta) throw new Error("Insufficient sandbox fiat balance");
  return formatUsdc(current - delta);
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const currentWallet = current.walletAddress?.toLowerCase();
  const invoices = await queryDatabase((database) => database.invoices
    .filter((invoice) => 
      invoice.senderId === current.id || 
      invoice.recipientUserId === current.id ||
      (currentWallet && invoice.recipientAddress.toLowerCase() === currentWallet)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  return NextResponse.json({ invoices });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Partial<StoredInvoice> & { paymentSessionToken?: string };
    if (body.fundingMethod !== "arc_wallet" && body.fundingMethod !== "unified_balance" && body.fundingMethod !== "cctp_bridge" && body.fundingMethod !== "fiat_bank") throw new Error("Invalid funding method");
    if (!body.recipientAddress || !isAddress(body.recipientAddress)) throw new Error("Invalid recipient address");
    if (!body.amount) throw new Error("Amount is required");
    const recipientAddress = body.recipientAddress;
    const amountRaw = parseUsdc(body.amount);
    const isFiat = body.fundingMethod === "fiat_bank";
    const txHash = isFiat ? String(body.txHash ?? `fiat-${randomUUID()}`) : String(body.txHash ?? "");
    if (!isFiat && (!body.txHash || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash) || !isTransactionHash(body.txHash))) throw new Error("Invalid Arc transaction hash");

    const invoice: StoredInvoice = {
      id: randomUUID(),
      senderId: current.id,
      recipientUserId: body.recipientUserId ?? null,
      recipientAddress,
      recipientLabel: String(body.recipientLabel ?? recipientAddress).slice(0, 80),
      amount: body.amount,
      token: "USDC",
      fundingMethod: body.fundingMethod,
      sourceChain: body.sourceChain ? String(body.sourceChain).slice(0, 40) : undefined,
      protocol: isFiat ? "fiat" : body.fundingMethod === "cctp_bridge" ? "cctp" : body.fundingMethod === "unified_balance" ? "gateway" : "send",
      bridgeSteps: body.fundingMethod === "cctp_bridge" && Array.isArray(body.bridgeSteps)
        ? body.bridgeSteps.slice(0, 8).map((step) => ({
          name: String(step.name ?? "step").slice(0, 40),
          txHash: step.txHash && isTransactionHash(step.txHash) ? step.txHash : undefined,
          explorerUrl: step.explorerUrl && /^https:\/\//.test(step.explorerUrl) ? String(step.explorerUrl).slice(0, 300) : undefined,
        }))
        : undefined,
      paymentSessionId: undefined,
      txHash,
      explorerUrl: isFiat ? "" : `https://testnet.arcscan.app/tx/${txHash}`,
      status: "confirmed",
      memo: String(body.memo ?? "").slice(0, 180),
      createdAt: new Date().toISOString(),
    };
    await mutateDatabase((database) => {
      const resolveRecipientUser = () => {
        if (body.recipientUserId) {
          return database.users.find((entry) => entry.id === body.recipientUserId) ?? null;
        }
        return database.users.find((entry) => entry.walletAddress && entry.walletAddress.toLowerCase() === recipientAddress.toLowerCase()) ?? null;
      };
      const recipientUser = resolveRecipientUser();
      if (recipientUser && !invoice.recipientUserId) {
        invoice.recipientUserId = recipientUser.id;
      }
      const senderUser = database.users.find((entry) => entry.id === current.id);
      if (!senderUser) throw new Error("Account not found");
      let fiatSender = senderUser;
      let fiatRecipient = recipientUser;

      if (body.paymentSessionToken) {
        const session = database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(body.paymentSessionToken!));
        if (!session) throw new Error("Payment session not found");
        if (session.status !== "ready") throw new Error("Payment session is not ready for execution");
        if (database.cctpOperations.some((operation) => operation.paymentSessionId === session.id && operation.status !== "failed")) throw new Error("This payment session already has a CCTP transfer in progress");
        const parties = paymentParties(session);
        if (parties.payerId !== current.id) throw new Error("Only the payer can execute this session");
        if (body.fundingMethod === "fiat_bank") {
          if (parties.payerRail !== "fiat_bank" && parties.receiverRail !== "fiat_bank") throw new Error("This payment session does not include a fiat rail");
          const payer = database.users.find((user) => user.id === parties.payerId);
          const receiver = database.users.find((user) => user.id === parties.receiverId);
          if (!payer || !receiver) throw new Error("Payment session participants are missing");
          fiatSender = payer;
          fiatRecipient = receiver;
        } else if (parties.payerRail !== "web3_usdc" || parties.receiverRail !== "web3_usdc") {
          throw new Error("A fiat provider is required for this rail combination");
        } else {
          const receiver = database.users.find((user) => user.id === parties.receiverId);
          if (!receiver?.walletAddress || receiver.walletAddress.toLowerCase() !== invoice.recipientAddress.toLowerCase()) throw new Error("Session recipient does not match the bound receiver wallet");
        }
        if (parseUsdc(session.amount) !== parseUsdc(invoice.amount)) throw new Error("Session amount does not match the transaction");
        invoice.paymentSessionId = session.id;
        session.status = "complete";
        session.invoiceId = invoice.id;
        session.updatedAt = new Date().toISOString();
      }

      if (body.fundingMethod === "fiat_bank") {
        if (!fiatRecipient) throw new Error("Fiat sandbox transfers require a registered recipient");
        if (parseUsdc(fiatSender.sandboxFiatBalance) < amountRaw) throw new Error("Insufficient sandbox fiat balance");
        fiatSender.sandboxFiatBalance = subtractUsdc(fiatSender.sandboxFiatBalance, amountRaw);
        fiatRecipient.sandboxFiatBalance = addUsdc(fiatRecipient.sandboxFiatBalance, amountRaw);
      }
      database.invoices.push(invoice);
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save invoice" }, { status: 400 });
  }
}
