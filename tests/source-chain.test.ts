import { describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { ensureGatewaySourceChain } from "../lib/arc/browser-wallet";

function wallet(chain = "0xaa36a7", failSwitch?: unknown, nonceError?: unknown) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return chain;
    if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
    if (method === "wallet_switchEthereumChain" && failSwitch) { const error = failSwitch; failSwitch = undefined; throw error; }
    if (method === "eth_getTransactionCount" && nonceError) throw nonceError;
    return "0x0";
  });
  return { provider: { request } as unknown as EIP1193Provider, request };
}

describe("source-chain activation", () => {
  it("keeps an already active chain and its RPC settings", async () => {
    const { provider, request } = wallet();
    await ensureGatewaySourceChain(provider, "Ethereum_Sepolia");
    expect(request.mock.calls.map(([arg]) => arg.method)).toEqual(["eth_chainId", "eth_accounts", "eth_getTransactionCount"]);
  });
  it("switches known networks without replacing their RPC settings", async () => {
    const { provider, request } = wallet("0x1");
    await ensureGatewaySourceChain(provider, "Ethereum_Sepolia");
    expect(request.mock.calls.some(([arg]) => arg.method === "wallet_addEthereumChain")).toBe(false);
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  });
  it("adds a missing network then switches to it", async () => {
    const { provider, request } = wallet("0x1", { code: 4902 });
    await ensureGatewaySourceChain(provider, "Ethereum_Sepolia");
    expect(request.mock.calls.map(([arg]) => arg.method)).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_accounts", "eth_getTransactionCount"]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_addEthereumChain", params: [expect.objectContaining({ rpcUrls: expect.arrayContaining(["https://ethereum-sepolia-rpc.publicnode.com"]) })] }));
  });
  it("does not add a chain after a user rejects switching", async () => {
    const { provider, request } = wallet("0x1", { code: 4001 });
    await expect(ensureGatewaySourceChain(provider, "Ethereum_Sepolia")).rejects.toThrow("rejected");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("explains the wallet's retired RPC before transaction preparation", async () => {
    const { provider } = wallet("0xaa36a7", undefined, new Error("chain is not available on free plan"));
    await expect(ensureGatewaySourceChain(provider, "Ethereum_Sepolia")).rejects.toThrow("https://ethereum-sepolia-rpc.publicnode.com");
  });
});
