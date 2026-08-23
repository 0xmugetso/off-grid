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
  updatedAt: string;
  expiresAt: string;
  inviteTokenHash?: string;
  sessionPath?: string | null;
  payerInputRail?: string | null;
  receiverOutputRail?: string | null;
  receiverBankDetails?: ReceiverBankDetails | null;
  fiatSettlement?: {
    mode: "fiat_to_web3" | "web3_to_fiat" | "fiat_to_fiat";
    stage: string;
    wireSubmittedAt?: string | null;
    mockWireTrackingRef: string | null;
    circleDepositId?: string | null;
    circleDepositStatus?: string | null;
    circleDepositAmount?: string | null;
    circleDepositCreateDate?: string | null;
    circleBalanceAfterDeposit?: string | null;
    circleTransferId: string | null;
    circleTransferStatus: string | null;
    circleTransferTxHash: string | null;
    receiverTransferId: string | null;
    receiverTransferState: string | null;
    receiverTxHash: string | null;
    settlementWalletAddress?: string | null;
    settlementWalletBalanceBefore?: string | null;
    arcBlockNumber?: string | null;
    error: string | null;
    updatedAt: string;
  } | null;
  payerRailStatus?: string;
  receiverRailStatus?: string;
  clearingStatus?: string;
  arcEscrowTxHash?: string | null;
  role: "creator" | "counterparty" | "invitee";
  actionRole: "payer" | "receiver";
  payerRail: PaymentRail | null;
  receiverRail: PaymentRail | null;
  nextAction: "share" | "choose" | "pay" | "wait" | "receipt" | "closed";
  nextActionLabel: string;
}
