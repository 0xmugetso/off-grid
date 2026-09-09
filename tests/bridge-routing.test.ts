import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ estimateDeposit: vi.fn(), deposit: vi.fn(), estimateBridge: vi.fn(), bridge: vi.fn() }));
vi.mock("@circle-fin/app-kit", () => ({ AppKit: class { unifiedBalance = { estimateDeposit: calls.estimateDeposit, deposit: calls.deposit }; estimateBridge = calls.estimateBridge; bridge = calls.bridge; }, isRetryableError: () => false }));
import { ArcPayrollClient, type CircleAdapter, supportsFastDeposit } from "../lib/arc/app-kit-client";
import { isSubmittedCctpOperation } from "../lib/cctp-operations";
const recipient = "0x2222222222222222222222222222222222222222";
const adapter = { ensureChain: vi.fn() } as unknown as CircleAdapter;
beforeEach(() => vi.clearAllMocks());
describe("documented deposit and bridge routes", () => {
  it("uses Fast Deposits only for supported sources", async () => {
    const client = new ArcPayrollClient();
    await client.estimateDeposit(adapter, "Ethereum_Sepolia", "3");
    expect(calls.estimateDeposit).toHaveBeenCalledWith(expect.objectContaining({ to: { chain: "Arc_Testnet" }, config: { transferSpeed: "FAST" } }));
    expect(supportsFastDeposit("Arbitrum_Sepolia")).toBe(true);
    expect(supportsFastDeposit("Base_Sepolia")).toBe(false);
    await client.estimateDeposit(adapter, "Base_Sepolia", "3");
    expect(calls.estimateDeposit.mock.calls[1][0].to).toBeUndefined();
  });
  it("retains the reviewed fast quote when executing", async () => {
    const client = new ArcPayrollClient();
    const estimate = { amount: "3", token: "USDC" as const, to: { chain: "Arc_Testnet" as const }, config: { transferSpeed: "FAST" as const }, quote: "0x1234", fees: [] };
    await client.deposit(adapter, "Ethereum_Sepolia", "3", vi.fn(), estimate);
    expect(calls.deposit).toHaveBeenCalledWith(expect.objectContaining({ quote: "0x1234", to: { chain: "Arc_Testnet" }, amount: "3" }));
  });
  it("keeps another wallet as recipient with source-paid fees and the reviewed quote", async () => {
    const client = new ArcPayrollClient();
    await client.estimateBridgeToArc(adapter, "Ethereum_Sepolia", recipient, "3");
    expect(calls.estimateBridge).toHaveBeenCalledWith(expect.objectContaining({ to: { chain: "Arc_Testnet", recipientAddress: recipient, useForwarder: true }, config: { feePayment: "source", transferSpeed: "SLOW" } }));
    await client.bridgeToArc(adapter, "Ethereum_Sepolia", recipient, "3", "operation", "0x1234");
    expect(calls.bridge).toHaveBeenCalledWith(expect.objectContaining({ to: { chain: "Arc_Testnet", recipientAddress: recipient, useForwarder: true }, quote: "0x1234", amount: "3" }));
  });
  it("excludes legacy approval records while retaining actual failed burns", () => {
    expect(isSubmittedCctpOperation({ burnTxHash: "0xapproval", errorMessage: "Token approval confirmed, but this transaction is not a CCTP burn." })).toBe(false);
    expect(isSubmittedCctpOperation({ burnTxHash: "0xapproval", sourceTransactionKind: "approval" })).toBe(false);
    expect(isSubmittedCctpOperation({ burnTxHash: "0xburn", errorMessage: "Mint failed" })).toBe(true);
  });
});
