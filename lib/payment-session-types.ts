export type PaymentRail = "web3_usdc" | "fiat_bank";

export interface DatabaseUserView {
  id: string;
  email: string;
  username: string;
  displayName: string;
  walletAddress: string | null;
  sandboxFiatBalance: string;
  sandboxFiatPending: string;
  createdAt: string;
}

export type PaymentParticipant = Pick<DatabaseUserView, "id" | "username" | "displayName" | "walletAddress" | "createdAt">;

export interface ReceiverBankDetails {
  accountHolderName: string;
  ibanOrAccountNumber: string;
  routingOrSwift: string;
  bankCountry: string;
}

export interface PaymentSessionView {
  id: string;
  creator: PaymentParticipant | null;
  counterparty: PaymentParticipant | null;
  creatorIntent: "pay" | "receive";
  creatorRail: PaymentRail;
  counterpartyRail: PaymentRail | null;
  amount: string;
  currency: "USD";
  memo: string;
  status: "open" | "ready" | "complete" | "cancelled" | "archived" | "expired";
  invoiceId: string | null;
  createdAt: string;
  expiresAt: string;
  inviteTokenHash?: string;
  payerInputRail?: string | null;
  receiverOutputRail?: string | null;
  receiverBankDetails?: ReceiverBankDetails | null;
  payerRailStatus?: string;
  receiverRailStatus?: string;
  clearingStatus?: string;
  arcEscrowTxHash?: string | null;
  role: "creator" | "counterparty" | "invitee";
  actionRole: "payer" | "receiver";
  payerRail: PaymentRail | null;
  receiverRail: PaymentRail | null;
}
