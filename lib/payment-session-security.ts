import { createHash, randomBytes } from "node:crypto";
import type { StoredPaymentSession } from "./server/store";

export function createInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function paymentParties(session: StoredPaymentSession) {
  return session.creatorIntent === "pay"
    ? { payerId: session.creatorId, receiverId: session.counterpartyId, payerRail: session.creatorRail, receiverRail: session.counterpartyRail }
    : { payerId: session.counterpartyId, receiverId: session.creatorId, payerRail: session.counterpartyRail, receiverRail: session.creatorRail };
}
