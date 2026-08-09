import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { parseUsdc } from "@/lib/money";
import { ARC } from "@/lib/arc/config";
import {
  circleEscrowConfiguration,
  deployRefundProtocol,
  ensureCircleEscrowWallet,
  executeEscrowContract,
  getCircleEscrowTransaction,
  getRefundProtocolContract,
} from "@/lib/server/arc-escrow-circle";
import { mutateDatabase, queryDatabase, type EscrowStatus, type StoredEscrow } from "@/lib/server/store";

function participantCanAccess(item: StoredEscrow, userId: string, walletAddress: string) {
  const wallet = walletAddress.toLowerCase();
  return item.creatorId === userId
    || item.providerUserId === userId
    || item.clientAddress.toLowerCase() === wallet
    || item.providerAddress.toLowerCase() === wallet;
}

function pendingTransaction(item: StoredEscrow) {
  if (item.status === "deploying") return item.deploymentTransactionId;
  if (item.status === "approving") return item.approvalTransactionId;
  if (item.status === "locking") return item.depositTransactionId;
  if (item.status === "releasing") return item.releaseTransactionId;
  if (item.status === "refunding") return item.refundTransactionId;
  return undefined;
}

function failedFallback(status: EscrowStatus): EscrowStatus {
  if (status === "approving" || status === "locking") return "open";
  if (status === "releasing" || status === "refunding") return "locked";
  return "failed";
}

async function reconcileEscrow(id: string) {
  const item = await queryDatabase((database) => database.escrows.find((entry) => entry.id === id) ?? null);
  if (!item) return null;
  const transactionId = pendingTransaction(item);
  if (!transactionId) return item;

  try {
    const observation = await getCircleEscrowTransaction(transactionId);
    if (observation.state !== "COMPLETE" && observation.state !== "FAILED") {
      await mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === id);
        if (target) {
          target.circleTransactionState = observation.state;
          target.updatedAt = new Date().toISOString();
        }
      });
      return item;
    }

    if (observation.state === "FAILED") {
      return mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === id);
        if (!target) return null;
        target.status = failedFallback(target.status);
        target.circleTransactionState = observation.state;
        target.lastError = observation.errorReason || "Circle contract transaction failed";
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] Circle transaction failed: ${target.lastError}`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }

    if (item.status === "deploying") {
      const contractAddress = observation.contractAddress
        || (item.circleContractId ? await getRefundProtocolContract(item.circleContractId) : undefined);
      if (!contractAddress) return item;
      return mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === id);
        if (!target) return null;
        target.status = "open";
        target.contractAddress = contractAddress;
        target.circleTransactionState = "COMPLETE";
        target.depositTxHash = observation.txHash;
        target.lastError = undefined;
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] RefundProtocol deployed on Arc Testnet at ${contractAddress}.`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }

    if (item.status === "approving") {
      if (!item.contractAddress || !item.depositorCircleWalletId || !item.beneficiaryCircleWalletAddress || !item.depositorCircleWalletAddress) {
        throw new Error("Escrow wallet or contract deployment data is incomplete");
      }
      const payment = await executeEscrowContract({
        walletId: item.depositorCircleWalletId,
        contractAddress: item.contractAddress,
        signature: "pay(address,uint256,address)",
        // Keep the official Circle SCA pay step, but return any recipient
        // refund to the creator's connected wallet (the wallet that funded
        // the session), not to the temporary depositor SCA.
        parameters: [item.beneficiaryCircleWalletAddress, parseUsdc(item.amount).toString(), item.clientAddress],
      });
      return mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === id);
        if (!target) return null;
        target.status = "locking";
        target.approvalTransactionId = transactionId;
        target.depositTransactionId = payment.id;
        target.circleTransactionState = payment.state;
        target.lastError = undefined;
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] USDC approval confirmed; RefundProtocol pay transaction submitted.`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
    }

    return mutateDatabase((database) => {
      const target = database.escrows.find((entry) => entry.id === id);
      if (!target) return null;
      const now = new Date().toISOString();
      target.circleTransactionState = "COMPLETE";
      target.lastError = undefined;
      if (target.status === "locking") {
        target.status = "locked";
        target.depositTxHash = observation.txHash;
        target.aiVerificationLogs.push(`[${now}] USDC deposit confirmed. Payment 0 is locked in RefundProtocol.`);
      } else if (target.status === "releasing") {
        target.status = "closed";
        target.releaseTxHash = observation.txHash;
        target.aiVerificationLogs.push(`[${now}] AI-approved deliverable released payment 0 to the beneficiary wallet.`);
      } else if (target.status === "refunding") {
        target.status = "refunded";
        target.refundTxHash = observation.txHash;
        target.aiVerificationLogs.push(`[${now}] Beneficiary refund confirmed; payment 0 returned to the depositor wallet.`);
      }
      target.updatedAt = now;
      return target;
    });
  } catch (error) {
    await mutateDatabase((database) => {
      const target = database.escrows.find((entry) => entry.id === id);
      if (!target) return;
      target.lastError = error instanceof Error ? error.message : "Unable to refresh Circle escrow transaction";
      target.updatedAt = new Date().toISOString();
    });
    return item;
  }
}

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const visible = await queryDatabase((database) => database.escrows
    .filter((item) => participantCanAccess(item, current.id, current.walletAddress))
    .map((item) => item.id));
  await Promise.allSettled(visible.map((id) => reconcileEscrow(id)));
  const escrows = await queryDatabase((database) => database.escrows
    .filter((item) => participantCanAccess(item, current.id, current.walletAddress))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  return NextResponse.json({ escrows, configuration: circleEscrowConfiguration() });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Partial<StoredEscrow>;
    if (!current.walletAddress) throw new Error("Connect and bind an EVM wallet before creating an escrow");
    if (!body.title || body.title.trim().length < 3) throw new Error("Title is required (min 3 characters)");
    if (!body.providerAddress || !isAddress(body.providerAddress)) throw new Error("Select a registered provider wallet address");
    if (!body.amount || parseUsdc(body.amount) <= 0n) throw new Error("Amount must be greater than 0 USDC");
    if (!body.specs || body.specs.trim().length < 5) throw new Error("AI validation criteria are required");

    const provider = await queryDatabase((database) => database.users.find((user) => user.walletAddress.toLowerCase() === body.providerAddress!.toLowerCase()) ?? null);
    if (!provider || provider.id === current.id) throw new Error("Choose another registered OffGrid user as the beneficiary");

    const now = new Date().toISOString();
    const escrow: StoredEscrow = {
      id: randomUUID(),
      creatorId: current.id,
      providerUserId: provider.id,
      title: body.title.trim().slice(0, 100),
      category: body.category && ["code", "digital_goods", "api_key", "freelance"].includes(body.category) ? body.category : "code",
      clientAddress: current.walletAddress,
      clientName: current.displayName || `@${current.username}`,
      providerAddress: provider.walletAddress,
      providerName: provider.displayName || `@${provider.username}`,
      amount: body.amount,
      specs: body.specs.trim().slice(0, 2000),
      terms: body.terms,
      contractFileName: body.contractFileName,
      contractFileHash: body.contractFileHash,
      status: "initiated",
      paymentId: 0,
      aiVerificationLogs: [
        `[${now}] Agreement created from Circle's RefundProtocol workflow.`,
        `[${now}] Depositor and beneficiary terms locked; awaiting smart-contract deployment.`,
      ],
      createdAt: now,
      updatedAt: now,
    };
    await mutateDatabase((database) => { database.escrows.unshift(escrow); });
    return NextResponse.json({ escrow, configuration: circleEscrowConfiguration() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create escrow" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { id?: string; action?: "deploy" | "fund" | "refund" | "refresh" };
    if (!body.id || !body.action) throw new Error("Escrow ID and action are required");
    const item = await queryDatabase((database) => database.escrows.find((entry) => entry.id === body.id) ?? null);
    if (!item) throw new Error("Escrow agreement not found");
    if (!participantCanAccess(item, current.id, current.walletAddress)) throw new Error("Only escrow participants can update this agreement");

    if (body.action === "refresh") {
      const escrow = await reconcileEscrow(item.id);
      return NextResponse.json({ escrow });
    }

    if (body.action === "deploy") {
      if (item.creatorId !== current.id || item.status !== "initiated") throw new Error("Only the depositor can deploy an initiated escrow");
      if (!item.providerUserId) throw new Error("Beneficiary account is not linked");
      const [depositorWallet, beneficiaryWallet] = await Promise.all([
        ensureCircleEscrowWallet(current.id),
        ensureCircleEscrowWallet(item.providerUserId),
      ]);
      const deployment = await deployRefundProtocol(item.title);
      const escrow = await mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === item.id)!;
        target.status = "deploying";
        target.circleContractId = deployment.contractId;
        target.deploymentTransactionId = deployment.transactionId;
        target.depositorCircleWalletId = depositorWallet.walletId;
        target.depositorCircleWalletAddress = depositorWallet.address;
        target.beneficiaryCircleWalletId = beneficiaryWallet.walletId;
        target.beneficiaryCircleWalletAddress = beneficiaryWallet.address;
        target.circleTransactionState = "INITIATED";
        target.lastError = undefined;
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] Circle Smart Contract Platform deployment submitted.`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
      return NextResponse.json({ escrow });
    }

    if (body.action === "fund") {
      if (item.creatorId !== current.id || item.status !== "open") throw new Error("Only the depositor can fund an open escrow");
      if (!item.contractAddress || !item.depositorCircleWalletId) throw new Error("RefundProtocol deployment is incomplete");
      const approval = await executeEscrowContract({
        walletId: item.depositorCircleWalletId,
        contractAddress: ARC.contracts.usdc,
        signature: "approve(address,uint256)",
        parameters: [item.contractAddress, parseUsdc(item.amount).toString()],
      });
      const escrow = await mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === item.id)!;
        target.status = "approving";
        target.approvalTransactionId = approval.id;
        target.circleTransactionState = approval.state;
        target.lastError = undefined;
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] USDC approval submitted from the depositor Circle wallet.`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
      return NextResponse.json({ escrow });
    }

    if (item.providerUserId !== current.id || item.status !== "locked") throw new Error("Only the beneficiary can refund a locked escrow");
    if (!item.contractAddress || !item.beneficiaryCircleWalletId) throw new Error("RefundProtocol deployment is incomplete");
    const refund = await executeEscrowContract({
      walletId: item.beneficiaryCircleWalletId,
      contractAddress: item.contractAddress,
      signature: "refundByRecipient(uint256)",
      parameters: [item.paymentId ?? 0],
    });
    const escrow = await mutateDatabase((database) => {
      const target = database.escrows.find((entry) => entry.id === item.id)!;
      target.status = "refunding";
      target.refundTransactionId = refund.id;
      target.circleTransactionState = refund.state;
      target.lastError = undefined;
      target.aiVerificationLogs.push(`[${new Date().toISOString()}] Beneficiary-authorized RefundProtocol refund submitted.`);
      target.updatedAt = new Date().toISOString();
      return target;
    });
    return NextResponse.json({ escrow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escrow action failed";
    return NextResponse.json({ error: message }, { status: message.includes("Only") ? 403 : 400 });
  }
}
