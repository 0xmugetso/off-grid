import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from "viem";
import { ARC } from "../lib/arc/config";
const mock = vi.hoisted(() => ({ deposit: {} as any, state: "COMPLETE", sourceStatus: "0x1", creditAmount: 3_000_000n }));
vi.mock("@/lib/server/auth", () => ({ getCurrentUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/server/store", () => ({ queryDatabase: async (read: any) => read({ gatewayDeposits: [mock.deposit] }), mutateDatabase: async (write: any) => write({ gatewayDeposits: [mock.deposit] }) }));
import { GET } from "../app/api/gateway-deposits/route";
const account = "0x1111111111111111111111111111111111111111";
const sourceHash = "0x" + "a".repeat(64);
const destinationHash = "0x" + "b".repeat(64);
beforeEach(() => {
  mock.state = "COMPLETE"; mock.sourceStatus = "0x1"; mock.creditAmount = 3_000_000n;
  mock.deposit = { id: "deposit", ownerId: "owner", sourceChain: "Ethereum_Sepolia", sourceDomain: 0, sourceAddress: account, mode: "fast", amount: "3", txHash: sourceHash, status: "submitted", createdAt: new Date().toISOString() };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("iris")) return Response.json({ messages: [{ decodedMessage: { destinationDomain: 26 }, forwardState: mock.state, forwardTxHash: destinationHash }] });
    const { params } = JSON.parse(String(init.body));
    if (params[0] === sourceHash) return Response.json({ result: { status: mock.sourceStatus, to: "0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A", blockNumber: "0x123" } });
    const abi = parseAbi(["event Deposited(address indexed token, address indexed depositor, address indexed sender, uint256 value)"]);
    return Response.json({ result: { status: "0x1", logs: [{ address: "0x0077777d7eba4688bdef3e311b846f25870a19b9", topics: encodeEventTopics({ abi, eventName: "Deposited", args: { token: ARC.contracts.usdc, depositor: account, sender: account } }), data: encodeAbiParameters(parseAbiParameters("uint256"), [mock.creditAmount]) }] } });
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe("persisted fast deposits", () => {
  it("confirms the Arc deposit and retains both transaction hashes", async () => {
    await GET();
    expect(mock.deposit.status).toBe("confirmed");
    expect(mock.deposit.txHash).toBe(sourceHash);
    expect(mock.deposit.destinationTxHash).toBe(destinationHash);
  });
  it("keeps a pending relay in flight rather than failing the burn contract check", async () => {
    mock.state = "PENDING";
    await GET();
    expect(mock.deposit.status).toBe("indexing");
  });
  it("rejects destination proof for the wrong amount", async () => {
    mock.creditAmount = 2_900_000n;
    await GET();
    expect(mock.deposit.status).toBe("indexing");
  });
  it("retains an actual relay failure for recovery", async () => {
    mock.state = "FAILED";
    await GET();
    expect(mock.deposit.status).toBe("failed");
  });
  it("does not poll the relay after a reverted burn", async () => {
    mock.sourceStatus = "0x0";
    await GET();
    expect(mock.deposit.status).toBe("failed");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("iris"))).toBe(false);
  });
});
