import { describe, expect, it } from "vitest";
import { selectCircleMintWireDeposit } from "./circle-mint-reconciliation";

describe("selectCircleMintWireDeposit", () => {
  const submittedAfter = "2026-08-23T17:23:00.000Z";

  it("matches Circle deposits without a trackingRef field", () => {
    const match = selectCircleMintWireDeposit([
      { id: "deposit-1", status: "complete", amount: { amount: "2.50", currency: "USD" }, createDate: "2026-08-23T17:23:25.579Z" },
    ], { amount: "2.50", submittedAfter });

    expect(match?.id).toBe("deposit-1");
  });

  it("rejects old, mismatched, and already claimed deposits", () => {
    const match = selectCircleMintWireDeposit([
      { id: "old", amount: { amount: "2.50", currency: "USD" }, createDate: "2026-08-23T17:22:59.999Z" },
      { id: "wrong-amount", amount: { amount: "3.00", currency: "USD" }, createDate: "2026-08-23T17:23:10.000Z" },
      { id: "claimed", amount: { amount: "2.50", currency: "USD" }, createDate: "2026-08-23T17:23:15.000Z" },
    ], { amount: "2.50", submittedAfter, excludedIds: ["claimed"] });

    expect(match).toBeNull();
  });

  it("selects the earliest unclaimed exact match", () => {
    const match = selectCircleMintWireDeposit([
      { id: "later", amount: { amount: "2.50", currency: "USD" }, createDate: "2026-08-23T17:24:00.000Z" },
      { id: "earlier", amount: { amount: "2.50", currency: "USD" }, createDate: "2026-08-23T17:23:20.000Z" },
    ], { amount: "2.50", submittedAfter });

    expect(match?.id).toBe("earlier");
  });
});
