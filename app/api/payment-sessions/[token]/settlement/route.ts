import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { hashInviteToken, paymentParties } from "@/lib/payment-session-security";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { sessionView } from "@/lib/server/payment-sessions";
import { createCircleMintSandboxMockWirePayment, fetchCircleMintBalances, findCircleMintWireDeposit } from "@/lib/server/circle-mint";
import { createSettlementWalletTransfer, getSettlementWalletTransfer, verifySettlementWalletTransfer } from "@/lib/server/circle-settlement-wallet";
import { mutateDatabase, queryDatabase, type StoredInvoice, type StoredPaymentSession } from "@/lib/server/store";

function sessionForToken(token: string) {
  return queryDatabase((database) => database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(token) || entry.inviteTokenHash === token) ?? null);
}

function maximumSandboxAmount() {
  const value = process.env.PAYMENT_SESSION_SANDBOX_MAX_USD?.trim() || "10";
  return parseUsdc(value);
}

function isCompleteState(state?: string | null) {
  return ["COMPLETE", "CONFIRMED"].includes(String(state || "").toUpperCase());
}

function isFailedState(state?: string | null) {
  return ["FAILED", "DENIED", "CANCELLED"].includes(String(state || "").toUpperCase());
}

async function viewFor(sessionId: string, userId: string) {
  return queryDatabase((database) => {
    const session = database.paymentSessions.find((entry) => entry.id === sessionId);
    if (!session) throw new Error("Payment session not found");
    return sessionView(session, database.users, userId);
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  try {
    let session = await sessionForToken(token);
    if (!session) throw new Error("Payment session not found");
    if (session.status !== "ready" && session.status !== "complete") throw new Error("This payment session is not ready");
    const parties = paymentParties(session);
    if (current.id !== parties.payerId && current.id !== parties.receiverId) throw new Error("Only session participants can advance settlement");
    if (parties.payerRail !== "fiat_bank" || parties.receiverRail !== "web3_usdc") {
      throw new Error("This settlement runner currently handles simulated fiat to Web3 USDC");
    }
    if (parseUsdc(session.amount) > maximumSandboxAmount()) {
      throw new Error(`Sandbox sessions are limited to ${formatUsdc(maximumSandboxAmount())} USD`);
    }
    const receiver = await queryDatabase((database) => database.users.find((entry) => entry.id === parties.receiverId) ?? null);
    if (!receiver?.walletAddress || !isAddress(receiver.walletAddress)) throw new Error("The receiver must bind a valid wallet address");

    if (!session.fiatSettlement) {
      if (current.id !== parties.payerId) throw new Error("Only the payer can start the sandbox bank payment");
      const bankAccountId = process.env.CIRCLE_MINT_BANK_ACCOUNT_ID?.trim();
      if (!bankAccountId) throw new Error("Circle Mint sandbox bank account is not configured");
      const balances = await fetchCircleMintBalances();
      const now = new Date().toISOString();
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id);
        if (!target?.fiatSettlement) {
          target!.fiatSettlement = {
            mode: "fiat_to_web3",
            stage: "not_started",
            startingCircleBalance: balances.availableUsd,
            wireSubmittedAt: null,
            mockWireTrackingRef: null,
            circleDepositId: null,
            circleDepositStatus: null,
            circleDepositAmount: null,
            circleDepositCreateDate: null,
            circleBalanceAfterDeposit: null,
            circleTransferId: null,
            circleTransferStatus: null,
            circleTransferTxHash: null,
            receiverTransferId: null,
            receiverTransferState: null,
            receiverTxHash: null,
            settlementWalletAddress: null,
            settlementWalletBalanceBefore: null,
            arcBlockNumber: null,
            wireIdempotencyKey: randomUUID(),
            circleTransferIdempotencyKey: randomUUID(),
            receiverTransferIdempotencyKey: randomUUID(),
            error: null,
            updatedAt: now,
          };
          target!.payerRailStatus = "funding";
          target!.clearingStatus = "awaiting_payer";
          target!.updatedAt = now;
        }
      });
      session = await sessionForToken(token);
    }

    const settlement = session!.fiatSettlement!;
    const now = new Date().toISOString();
    if (settlement.stage === "not_started" || (settlement.stage === "failed" && !settlement.mockWireTrackingRef)) {
      if (current.id !== parties.payerId) throw new Error("Only the payer can start the sandbox bank payment");
      const response = await createCircleMintSandboxMockWirePayment({
        bankAccountId: process.env.CIRCLE_MINT_BANK_ACCOUNT_ID!.trim(),
        amount: session!.amount,
        memo: `OffGrid session ${session!.id.slice(0, 8)}`,
      });
      const trackingRef = response.data?.trackingRef;
      if (!trackingRef) throw new Error("Circle accepted the mock wire but did not return its tracking reference");
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        target.fiatSettlement!.stage = "wire_submitted";
        target.fiatSettlement!.wireSubmittedAt = now;
        target.fiatSettlement!.mockWireTrackingRef = trackingRef;
        target.fiatSettlement!.error = null;
        target.fiatSettlement!.updatedAt = now;
        target.auditProof = { ...target.auditProof, circleMockWireTrackingRef: trackingRef, circleMockWireStatus: response.data?.status || "pending" };
        target.clearingStatus = "clearing_on_arc";
        target.updatedAt = now;
      });
    } else if (settlement.stage === "wire_submitted" || settlement.stage === "circle_balance_funded") {
      if (!settlement.mockWireTrackingRef) throw new Error("The Circle mock wire tracking reference is missing");
      const excludedDepositIds = await queryDatabase((database) => database.paymentSessions
        .filter((entry) => entry.id !== session!.id)
        .map((entry) => entry.fiatSettlement?.circleDepositId)
        .filter((id): id is string => Boolean(id)));
      const deposit = await findCircleMintWireDeposit({
        trackingRef: settlement.mockWireTrackingRef,
        amount: session!.amount,
        submittedAfter: settlement.wireSubmittedAt || session!.createdAt,
        excludedIds: excludedDepositIds,
      });
      if (!deposit) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      const depositStatus = deposit.status || "pending";
      if (isFailedState(depositStatus)) throw new Error(`Circle sandbox deposit failed${deposit.riskEvaluation?.reason ? `: ${deposit.riskEvaluation.reason}` : ""}`);
      const balances = isCompleteState(depositStatus) ? await fetchCircleMintBalances() : null;
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        Object.assign(target.fiatSettlement!, {
          stage: isCompleteState(depositStatus) ? "circle_deposit_confirmed" : "wire_submitted",
          circleDepositId: deposit.id || null,
          circleDepositStatus: depositStatus,
          circleDepositAmount: deposit.amount?.amount || null,
          circleDepositCreateDate: deposit.createDate || null,
          circleBalanceAfterDeposit: balances?.availableUsd || null,
          error: null,
          updatedAt: now,
        });
        target.auditProof = {
          ...target.auditProof,
          circleDepositId: deposit.id,
          circleDepositStatus: depositStatus,
          circleDepositTrackingRef: deposit.trackingRef,
          circleDepositAmount: deposit.amount,
          circleDepositCreateDate: deposit.createDate,
          circleMintBalanceAfterDeposit: balances?.availableUsd,
        };
        target.updatedAt = now;
      });
      if (!isCompleteState(depositStatus)) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
    } else if (settlement.stage === "circle_deposit_confirmed") {
      const claimed = await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        if (target.fiatSettlement!.stage !== "circle_deposit_confirmed") return false;
        target.fiatSettlement!.stage = "receiver_transfer_creating";
        target.fiatSettlement!.error = null;
        target.fiatSettlement!.updatedAt = now;
        target.updatedAt = now;
        return true;
      });
      if (!claimed) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      try {
        const relay = await createSettlementWalletTransfer({
          idempotencyKey: settlement.receiverTransferIdempotencyKey,
          destinationAddress: receiver.walletAddress,
          amount: session!.amount,
          reference: `session-${session!.id.slice(0, 8)}`,
        });
        await mutateDatabase((database) => {
          const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
          Object.assign(target.fiatSettlement!, {
            stage: "receiver_transfer_submitted",
            receiverTransferId: relay.id,
            receiverTransferState: relay.state,
            settlementWalletAddress: relay.sourceAddress,
            settlementWalletBalanceBefore: relay.sourceBalanceBefore,
            error: null,
            updatedAt: now,
          });
          target.auditProof = {
            ...target.auditProof,
            settlementWalletAddress: relay.sourceAddress,
            settlementWalletBalanceBefore: relay.sourceBalanceBefore,
            receiverTransferId: relay.id,
            receiverTransferState: relay.state,
          };
          target.updatedAt = now;
        });
      } catch (error) {
        await mutateDatabase((database) => {
          const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
          target.fiatSettlement!.stage = "circle_deposit_confirmed";
          target.fiatSettlement!.updatedAt = new Date().toISOString();
          target.updatedAt = target.fiatSettlement!.updatedAt;
        });
        throw error;
      }
    } else if (settlement.stage === "receiver_transfer_creating") {
      return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
    } else if (settlement.stage === "receiver_transfer_submitted") {
      const relay = await getSettlementWalletTransfer(settlement.receiverTransferId!);
      if (isFailedState(relay.state)) throw new Error(`Settlement wallet transfer failed${relay.errorReason ? `: ${relay.errorReason}` : ""}`);
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        target.fiatSettlement!.receiverTransferState = relay.state;
        target.fiatSettlement!.receiverTxHash = relay.txHash;
        target.fiatSettlement!.updatedAt = now;
        target.updatedAt = now;
      });
      if (!isCompleteState(relay.state) || !relay.txHash) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      const chainProof = await verifySettlementWalletTransfer({
        txHash: relay.txHash as `0x${string}`,
        destinationAddress: receiver.walletAddress,
        amount: session!.amount,
      });
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        if (target.invoiceId) return;
        const recipient = database.users.find((entry) => entry.id === parties.receiverId)!;
        const invoice: StoredInvoice = {
          id: randomUUID(), senderId: parties.payerId!, recipientUserId: recipient.id,
          recipientAddress: recipient.walletAddress, recipientLabel: recipient.displayName,
          amount: target.amount, token: "USDC", fundingMethod: "fiat_bank", sourceChain: "Circle sandbox + Arc Testnet",
          protocol: "fiat", paymentSessionId: target.id, txHash: relay.txHash!,
          explorerUrl: `https://testnet.arcscan.app/tx/${relay.txHash}`, status: "confirmed", memo: target.memo,
          createdAt: now,
        };
        database.invoices.push(invoice);
        target.invoiceId = invoice.id;
        target.status = "complete";
        target.payerRailStatus = "funded_on_arc";
        target.receiverRailStatus = "settled";
        target.clearingStatus = "settled";
        target.arcEscrowTxHash = relay.txHash;
        target.fiatSettlement!.stage = "complete";
        target.fiatSettlement!.arcBlockNumber = chainProof.blockNumber;
        target.auditProof = {
          ...target.auditProof,
          receiverTransferState: relay.state,
          receiverTxHash: relay.txHash,
          arcBlockNumber: chainProof.blockNumber,
          arcBlockHash: chainProof.blockHash,
          onchainUsdcTransferVerified: true,
          completedAt: now,
        };
        target.updatedAt = now;
      });
    }
    return NextResponse.json({ session: await viewFor(session!.id, current.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to advance sandbox settlement";
    const found = await sessionForToken(token).catch(() => null);
    if (found?.fiatSettlement) {
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === found.id);
        if (target?.fiatSettlement) {
          target.fiatSettlement.error = message;
          target.fiatSettlement.updatedAt = new Date().toISOString();
          target.updatedAt = target.fiatSettlement.updatedAt;
        }
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: message.startsWith("Only ") ? 403 : 400 });
  }
}
