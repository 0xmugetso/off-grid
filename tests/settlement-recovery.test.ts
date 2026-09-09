import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { paymentSessions: [] as any[], users: [] as any[], invoices: [] as any[] },
  createTransfer: vi.fn(), getTransfer: vi.fn(), verifyTransfer: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => ({ id: "payer" }) }));
vi.mock("@/lib/server/store", () => ({
  queryDatabase: async (read: any) => read(structuredClone(mocks.database)),
  mutateDatabase: async (write: any) => write(mocks.database),
}));
vi.mock("@/lib/server/payment-sessions", () => ({ sessionView: (session: any) => session }));
vi.mock("@/lib/server/circle-mint", () => ({}));
vi.mock("@/lib/server/circle-settlement-wallet", () => ({
  createSettlementWalletTransfer: mocks.createTransfer,
  getSettlementWalletTransfer: mocks.getTransfer,
  verifySettlementWalletTransfer: mocks.verifyTransfer,
  verifyArcUsdcTransfer: vi.fn(),
}));
import { POST } from "../app/api/payment-sessions/[token]/settlement/route";
const token = "a".repeat(64);
const address = "0x1111111111111111111111111111111111111111";
function post() { return POST(new Request("http://localhost/settlement", { method: "POST" }), { params: Promise.resolve({ token }) }); }
function saved() { return mocks.database.paymentSessions[0]; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.database.users = [{ id: "payer" }, { id: "receiver", walletAddress: address, displayName: "Recipient" }];
  mocks.database.invoices = [];
  mocks.database.paymentSessions = [{
    id: "session-1", inviteTokenHash: token, creatorId: "payer", counterpartyId: "receiver",
    creatorIntent: "pay", creatorRail: "fiat_bank", counterpartyRail: "web3_usdc",
    payerInputRail: "fiat_bank", receiverOutputRail: "web3_usdc", amount: "5.00", status: "ready", memo: "",
    fiatSettlement: { stage: "circle_deposit_confirmed", mode: "fiat_to_web3", receiverTransferIdempotencyKey: "original-key", updatedAt: new Date().toISOString() },
  }];
  mocks.createTransfer.mockResolvedValue({ id: "transfer-1", state: "INITIATED", sourceAddress: address, sourceBalanceBefore: "8.50" });
});

describe("fiat payment recovery", () => {
  it("submits a verified deposit once and persists the provider reference", async () => {
    expect((await post()).status).toBe(200);
    expect(saved().fiatSettlement.receiverTransferId).toBe("transfer-1");
    expect(mocks.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "original-key", amount: "5.00", retry: false }));
  });
  it("does not resubmit while another request holds a live claim", async () => {
    saved().fiatSettlement.stage = "receiver_transfer_creating";
    saved().fiatSettlement.receiverTransferStartedAt = new Date().toISOString();
    await post();
    expect(mocks.createTransfer).not.toHaveBeenCalled();
  });
  it("recovers an interrupted legacy claim using the original idempotency key", async () => {
    saved().fiatSettlement.stage = "receiver_transfer_creating";
    saved().fiatSettlement.updatedAt = new Date(Date.now() - 120_000).toISOString();
    await post();
    expect(mocks.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "original-key", retry: true }));
    expect(saved().fiatSettlement.stage).toBe("receiver_transfer_submitted");
  });
  it("keeps an ambiguous provider timeout replayable without making a new payment key", async () => {
    mocks.createTransfer.mockRejectedValueOnce(new Error("Provider timed out"));
    expect((await post()).status).toBe(400);
    expect(saved().fiatSettlement.error).toBe("Provider timed out");
    expect(saved().fiatSettlement.receiverTransferIdempotencyKey).toBe("original-key");
    expect(saved().fiatSettlement.stage).toBe("receiver_transfer_creating");
    saved().fiatSettlement.receiverTransferStartedAt = new Date(Date.now() - 120_000).toISOString();
    await post();
    expect(saved().fiatSettlement.receiverTransferId).toBe("transfer-1");
  });
  it("keeps a known funding shortage retryable after the wallet is topped up", async () => {
    const error = new Error("Delivery paused: insufficient settlement USDC");
    error.name = "SettlementWalletFundingError";
    mocks.createTransfer.mockRejectedValueOnce(error);
    await post();
    expect(saved().fiatSettlement.stage).toBe("circle_deposit_confirmed");
    expect(saved().fiatSettlement.error).toContain("insufficient settlement USDC");
    await post();
    expect(saved().fiatSettlement.stage).toBe("receiver_transfer_submitted");
    expect(mocks.createTransfer).toHaveBeenLastCalledWith(expect.objectContaining({ idempotencyKey: "original-key", retry: false }));
  });
  it("does not mark a transfer complete until its onchain proof is verified", async () => {
    saved().fiatSettlement.stage = "receiver_transfer_submitted";
    saved().fiatSettlement.receiverTransferId = "transfer-1";
    mocks.getTransfer.mockResolvedValue({ state: "CONFIRMED", txHash: "0xabc" });
    mocks.verifyTransfer.mockRejectedValueOnce(new Error("Receipt does not match"));
    await post();
    expect(saved().status).toBe("ready");
    expect(mocks.database.invoices).toHaveLength(0);
    mocks.verifyTransfer.mockResolvedValueOnce({ blockNumber: "123", blockHash: "0xblock" });
    await post();
    await post();
    expect(saved().status).toBe("complete");
    expect(mocks.database.invoices).toHaveLength(1);
  });
});
