import "server-only";

import type { PaymentParticipant, PaymentSessionView } from "@/lib/payment-session-types";
import { paymentParties } from "@/lib/payment-session-security";
import type { StoredPaymentSession, StoredUser } from "./store";

export function sessionView(session: StoredPaymentSession, users: StoredUser[], currentUserId: string): PaymentSessionView {
  const creator = users.find((user) => user.id === session.creatorId);
  const counterparty = users.find((user) => user.id === session.counterpartyId);
  const parties = paymentParties(session);
  const role = currentUserId === session.creatorId ? "creator" : currentUserId === session.counterpartyId ? "counterparty" : "invitee";
  const actionRole = currentUserId === parties.payerId ? "payer" : currentUserId === parties.receiverId ? "receiver" : session.creatorIntent === "pay" ? "receiver" : "payer";
  const { nextAction, nextActionLabel } = sessionAction(session, role, actionRole);
  return {
    id: session.id,
    creator: creator ? participantView(creator) : null,
    counterparty: counterparty ? participantView(counterparty) : null,
    creatorIntent: session.creatorIntent,
    creatorRail: session.creatorRail,
    counterpartyRail: session.counterpartyRail,
    amount: session.amount,
    currency: session.currency,
    memo: session.memo,
    status: session.status,
    invoiceId: session.invoiceId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    inviteTokenHash: session.inviteTokenHash,
    sessionPath: session.inviteToken ? `/session/${session.inviteToken}` : null,
    payerInputRail: session.payerInputRail,
    receiverOutputRail: session.receiverOutputRail,
    receiverBankDetails: session.receiverBankDetails ?? null,
    fiatSettlement: session.fiatSettlement ? {
      mode: session.fiatSettlement.mode,
      stage: session.fiatSettlement.stage,
      wireSubmittedAt: session.fiatSettlement.wireSubmittedAt ?? null,
      mockWireTrackingRef: session.fiatSettlement.mockWireTrackingRef,
      circleDepositId: session.fiatSettlement.circleDepositId ?? null,
      circleDepositStatus: session.fiatSettlement.circleDepositStatus ?? null,
      circleDepositAmount: session.fiatSettlement.circleDepositAmount ?? null,
      circleDepositCreateDate: session.fiatSettlement.circleDepositCreateDate ?? null,
      circleBalanceAfterDeposit: session.fiatSettlement.circleBalanceAfterDeposit ?? null,
      circleTransferId: session.fiatSettlement.circleTransferId,
      circleTransferStatus: session.fiatSettlement.circleTransferStatus,
      circleTransferTxHash: session.fiatSettlement.circleTransferTxHash,
      receiverTransferId: session.fiatSettlement.receiverTransferId,
      receiverTransferState: session.fiatSettlement.receiverTransferState,
      receiverTxHash: session.fiatSettlement.receiverTxHash,
      settlementWalletAddress: session.fiatSettlement.settlementWalletAddress ?? null,
      settlementWalletBalanceBefore: session.fiatSettlement.settlementWalletBalanceBefore ?? null,
      arcBlockNumber: session.fiatSettlement.arcBlockNumber ?? null,
      error: session.fiatSettlement.error,
      updatedAt: session.fiatSettlement.updatedAt,
    } : null,
    payerRailStatus: session.payerRailStatus,
    receiverRailStatus: session.receiverRailStatus,
    clearingStatus: session.clearingStatus,
    arcEscrowTxHash: session.arcEscrowTxHash,
    role,
    actionRole,
    payerRail: parties.payerRail,
    receiverRail: parties.receiverRail,
    nextAction,
    nextActionLabel,
  };
}

function sessionAction(
  session: StoredPaymentSession,
  role: PaymentSessionView["role"],
  actionRole: PaymentSessionView["actionRole"],
): Pick<PaymentSessionView, "nextAction" | "nextActionLabel"> {
  const parties = paymentParties(session);
  if (session.status === "complete") return { nextAction: "receipt", nextActionLabel: "Open the shared receipt" };
  if (["archived", "cancelled", "expired"].includes(session.status)) return { nextAction: "closed", nextActionLabel: "No action required" };
  if (session.status === "open") {
    return role === "creator"
      ? { nextAction: "share", nextActionLabel: "Share the private session link" }
      : { nextAction: "choose", nextActionLabel: `Choose how you want to ${actionRole === "payer" ? "pay" : "receive"}` };
  }
  return actionRole === "payer"
    ? { nextAction: "pay", nextActionLabel: parties.payerRail === "web3_usdc" && parties.receiverRail === "web3_usdc" ? "Review and submit the payment" : "Complete the provider settlement steps" }
    : { nextAction: "wait", nextActionLabel: "Waiting for the payer to complete settlement" };
}

function participantView(user: StoredUser): PaymentParticipant {
  return { id: user.id, username: user.username, displayName: user.displayName, walletAddress: user.walletAddress, createdAt: user.createdAt };
}
