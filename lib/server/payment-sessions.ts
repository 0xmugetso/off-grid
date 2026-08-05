import "server-only";

import type { PaymentParticipant, PaymentSessionView } from "@/lib/payment-session-types";
import { paymentParties } from "@/lib/payment-session-security";
import type { StoredPaymentSession, StoredUser } from "./store";

export function sessionView(session: StoredPaymentSession, users: StoredUser[], currentUserId: string): PaymentSessionView {
  const creator = users.find((user) => user.id === session.creatorId);
  const counterparty = users.find((user) => user.id === session.counterpartyId);
  const parties = paymentParties(session);
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
    expiresAt: session.expiresAt,
    inviteTokenHash: session.inviteTokenHash,
    payerInputRail: session.payerInputRail,
    receiverOutputRail: session.receiverOutputRail,
    receiverBankDetails: session.receiverBankDetails ?? null,
    payerRailStatus: session.payerRailStatus,
    receiverRailStatus: session.receiverRailStatus,
    clearingStatus: session.clearingStatus,
    arcEscrowTxHash: session.arcEscrowTxHash,
    role: currentUserId === session.creatorId ? "creator" : currentUserId === session.counterpartyId ? "counterparty" : "invitee",
    actionRole: currentUserId === parties.payerId ? "payer" : currentUserId === parties.receiverId ? "receiver" : session.creatorIntent === "pay" ? "receiver" : "payer",
    payerRail: parties.payerRail,
    receiverRail: parties.receiverRail,
  };
}

function participantView(user: StoredUser): PaymentParticipant {
  return { id: user.id, username: user.username, displayName: user.displayName, walletAddress: user.walletAddress, createdAt: user.createdAt };
}
