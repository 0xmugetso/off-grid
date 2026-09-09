import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ operation: {} as any }));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/server/store", () => ({
  queryDatabase: async (read: any) => read({ cctpOperations: [mock.operation] }),
  mutateDatabase: async (write: any) => write({ cctpOperations: [mock.operation] }),
}));
import { GET } from "../app/api/cctp-operations/route";
afterEach(() => vi.unstubAllGlobals());
describe("persisted CCTP tracking", () => {
  it("clears an old increaseAllowance record from pending without claiming payment", async () => {
    mock.operation = { id: "operation", ownerId: "owner", burnTxHash: "0x" + "1".repeat(64), sourceChain: "Base_Sepolia", sourceDomain: 6, status: "attesting" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("iris")) return new Response("{}", { status: 404 });
      const { method } = JSON.parse(String(init.body));
      return Response.json({ result: method === "eth_getTransactionReceipt" ? { status: "0x1" } : { input: "0x39509351" + "0".repeat(128) } });
    }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mock.operation.status).toBe("failed");
    expect(mock.operation.errorMessage).toContain("Token approval confirmed");
    expect(mock.operation.invoiceId).toBeUndefined();
  });
  it("does not turn RPC outages into failed transfers", async () => {
    mock.operation = { id: "operation", ownerId: "owner", burnTxHash: "0x" + "1".repeat(64), sourceChain: "Base_Sepolia", sourceDomain: 6, status: "attesting" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await GET();
    expect(mock.operation.status).toBe("attesting");
  });
});
