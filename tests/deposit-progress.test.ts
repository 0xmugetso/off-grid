import { describe, expect, it, vi } from "vitest";
import { observeDepositSubmission } from "../lib/arc/deposit-progress";

describe("Gateway deposit broadcast", () => {
  it.each(["gateway.v1.deposit", "gateway.v1.depositFor", "gateway.v1.depositWithPermit", "gateway.v1.depositWithAuthorization"])("reports %s before receipt confirmation", async (action) => {
    const submitted = vi.fn();
    const adapter = { prepareAction: async (_action: string) => ({ execute: async () => "0xdeposit" }) };
    const request = await observeDepositSubmission(adapter, submitted).prepareAction(action);
    expect(submitted).not.toHaveBeenCalled();
    expect(await request.execute()).toBe("0xdeposit");
    expect(submitted).toHaveBeenCalledExactlyOnceWith("0xdeposit");
  });
  it("does not report an approval as a deposit", async () => {
    const submitted = vi.fn();
    const adapter = { prepareAction: async (_action: string) => ({ execute: async () => "0xapproval" }) };
    await (await observeDepositSubmission(adapter, submitted).prepareAction("usdc.increaseAllowance")).execute();
    expect(submitted).not.toHaveBeenCalled();
  });
  it("does not report a rejected signature as submitted", async () => {
    const submitted = vi.fn();
    const adapter = { prepareAction: async (_action: string) => ({ execute: async () => { throw new Error("Rejected"); } }) };
    await expect((await observeDepositSubmission(adapter, submitted).prepareAction("gateway.v1.deposit")).execute()).rejects.toThrow("Rejected");
    expect(submitted).not.toHaveBeenCalled();
  });
  it("preserves adapter method context and receipt waiting", async () => {
    const adapter = { value: "receipt", waitForTransaction() { return this.value; } };
    expect(observeDepositSubmission(adapter, vi.fn()).waitForTransaction()).toBe("receipt");
  });
});
