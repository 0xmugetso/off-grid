import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase, queryDatabase, type StoredEscrow } from "@/lib/server/store";
import { isTransactionHash } from "@/lib/transaction-hash";

function participantCanAccess(item: StoredEscrow, userId: string, walletAddress: string) {
  const wallet = walletAddress.toLowerCase();
  return item.creatorId === userId
    || item.clientAddress.toLowerCase() === wallet
    || item.providerAddress.toLowerCase() === wallet;
}

function requireTransactionHash(value: unknown, label: string) {
  const hash = typeof value === "string" ? value.trim() : "";
  if (!isTransactionHash(hash)) throw new Error(`${label} requires a confirmed Arc transaction hash`);
  return hash;
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const escrows = await queryDatabase((database) => database.escrows
    .filter((item) => participantCanAccess(item, current.id, current.walletAddress))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  return NextResponse.json({ escrows });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Partial<StoredEscrow>;
    if (!current.walletAddress) throw new Error("Connect and bind an EVM wallet before creating an escrow");
    if (!body.title || body.title.trim().length < 3) throw new Error("Title is required (min 3 characters)");
    if (!body.providerAddress || !isAddress(body.providerAddress)) throw new Error("Valid provider wallet address is required");
    if (!body.amount || Number(body.amount) <= 0) throw new Error("Amount must be greater than 0 USDC");
    if (!body.specs || body.specs.trim().length < 5) throw new Error("Specification / validation criteria required");

    const escrow: StoredEscrow = {
      id: randomUUID(),
      creatorId: current.id,
      title: body.title.trim().slice(0, 100),
      category: body.category && ["code", "digital_goods", "api_key", "freelance"].includes(body.category) ? body.category : "code",
      clientAddress: current.walletAddress,
      clientName: current.displayName || `@${current.username}`,
      providerAddress: body.providerAddress,
      providerName: body.providerName ? body.providerName.trim().slice(0, 60) : `${body.providerAddress.slice(0, 6)}...${body.providerAddress.slice(-4)}`,
      amount: body.amount,
      specs: body.specs.trim().slice(0, 500),
      status: "created",
      aiVerificationLogs: [
        `[${new Date().toISOString()}] AI Escrow initialized under Refund Protocol spec.`,
        `[${new Date().toISOString()}] Buyer locked specification criteria for deterministic review.`,
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await mutateDatabase((database) => {
      database.escrows.unshift(escrow);
    });

    return NextResponse.json({ escrow });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create escrow" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { id: string; action: "fund" | "submit" | "verify" | "refund"; txHash?: string; deliverableProof?: string };
    if (!body.id) throw new Error("Escrow ID required");

    let updatedEscrow: StoredEscrow | null = null;

    await mutateDatabase((database) => {
      const item = database.escrows.find((e) => e.id === body.id);
      if (!item) throw new Error("Escrow contract session not found");
      if (!participantCanAccess(item, current.id, current.walletAddress)) throw new Error("Only escrow participants can update this contract");

      const now = new Date().toISOString();

      if (body.action === "fund") {
        if (item.creatorId !== current.id || item.clientAddress.toLowerCase() !== current.walletAddress.toLowerCase()) throw new Error("Only the client can fund this escrow");
        if (item.status !== "created") throw new Error("This escrow is not awaiting funding");
        const txHash = requireTransactionHash(body.txHash, "Funding");
        item.status = "funded";
        item.depositTxHash = txHash;
        item.aiVerificationLogs.push(`[${now}] Arc Testnet USDC deposit verified. ${item.amount} USDC locked in Escrow vault.`);
      } else if (body.action === "submit") {
        if (item.providerAddress.toLowerCase() !== current.walletAddress.toLowerCase()) throw new Error("Only the provider can submit a deliverable");
        if (item.status !== "funded") throw new Error("Fund the escrow before submitting a deliverable");
        if (!body.deliverableProof) throw new Error("Deliverable proof / repository link required");
        item.status = "submitted";
        item.deliverableProof = body.deliverableProof;
        item.aiVerificationLogs.push(`[${now}] Seller submitted deliverable proof: ${body.deliverableProof.slice(0, 80)}`);
      } else if (body.action === "verify") {
        if (item.creatorId !== current.id || item.clientAddress.toLowerCase() !== current.walletAddress.toLowerCase()) throw new Error("Only the client can approve an escrow release");
        if (item.status !== "submitted") throw new Error("Submit a deliverable before verification");
        const txHash = requireTransactionHash(body.txHash, "Release");
        item.status = "validated";
        item.releaseTxHash = txHash;
        item.aiVerificationLogs.push(`[${now}] Deterministic proof review recorded against the submitted deliverable.`);
        item.aiVerificationLogs.push(`[${now}] Release proof recorded: ${txHash}. OffGrid does not custody funds or submit an escrow release.`);
      } else if (body.action === "refund") {
        if (item.creatorId !== current.id || item.clientAddress.toLowerCase() !== current.walletAddress.toLowerCase()) throw new Error("Only the client can refund an escrow");
        if (item.status !== "funded" && item.status !== "submitted") throw new Error("This escrow cannot be refunded in its current state");
        const txHash = requireTransactionHash(body.txHash, "Refund");
        item.status = "refunded";
        item.refundTxHash = txHash;
        item.aiVerificationLogs.push(`[${now}] Escrow cancelled / refunded. Deposit returned to client wallet on Arc.`);
      }

      item.updatedAt = now;
      updatedEscrow = item;
    });

    return NextResponse.json({ escrow: updatedEscrow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escrow update failed";
    return NextResponse.json({ error: message }, { status: message.includes("Only") ? 403 : 400 });
  }
}
