import { describe, expect, it } from "vitest";
import { cctpSourceFailure } from "../lib/cctp-source-proof";
import { isCctpBurnSubmissionData } from "../lib/arc/app-kit-client";

describe("CCTP approval tracking regression", () => {
  it.each(["0x095ea7b3", "0x39509351", "0xa457c2d7"])("does not treat %s as a burn", (selector) => {
    const input = selector + "0".repeat(128);
    expect(isCctpBurnSubmissionData(input)).toBe(false);
    expect(cctpSourceFailure({ status: "0x1" }, { input })).toContain("Token approval confirmed");
  });
  it("keeps unknown or unmined transactions pending", () => {
    expect(cctpSourceFailure(null, null)).toBeNull();
    expect(cctpSourceFailure({ status: "0x1" }, { input: "0x6fd3504e" })).toBeNull();
  });
  it("recognizes a reverted source transaction", () => {
    expect(cctpSourceFailure({ status: "0x0" }, { input: "0x6fd3504e" })).toContain("reverted");
  });
});
