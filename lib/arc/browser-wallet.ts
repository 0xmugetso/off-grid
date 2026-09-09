"use client";

import type { EIP1193Provider } from "viem";
import { createPublicClient, custom, formatUnits, getAddress, http } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC, ETHEREUM_SEPOLIA_RPC_URLS, type EvmSourceChain } from "./config";

export interface BrowserWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<BrowserWallet>;
  }
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export async function discoverBrowserWallets(): Promise<BrowserWallet[]> {
  const providers = new Map<string, BrowserWallet>();
  const onAnnounce = ((event: CustomEvent<BrowserWallet>) => {
    providers.set(event.detail.info.uuid, event.detail);
  }) as unknown as EventListener;
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  if (!providers.size && window.ethereum) {
    providers.set("legacy-injected", { info: { uuid: "legacy-injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: window.ethereum });
  }
  return [...providers.values()];
}

export async function requestWalletAccount(provider: EIP1193Provider) {
  await provider.request({ method: "eth_requestAccounts", params: undefined });
  const accounts = await provider.request({ method: "eth_accounts", params: undefined }) as string[];
  if (!accounts[0]) throw new Error("The wallet did not return an account");
  return getAddress(accounts[0]);
}

export async function ensureArcTestnet(provider: EIP1193Provider) {
  const chainId = `0x${ARC.chainId.toString(16)}`;
  const currentChainId = await provider.request({ method: "eth_chainId", params: undefined }).catch(() => null);
  if (typeof currentChainId === "string" && Number.parseInt(currentChainId, 16) === ARC.chainId) return;

  let addError: unknown;
  try {
    // Add first. Wallets that already know Arc may return an "already added"
    // error; switching immediately afterwards is still safe and idempotent.
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: ARC.name,
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: [ARC.rpcUrl],
        blockExplorerUrls: [ARC.explorerUrl],
      }],
    });
  } catch (error) {
    if (isUserRejection(error)) throw new Error("Arc network request was rejected in your wallet");
    addError = error;
  }

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (isUserRejection(error)) throw new Error("Arc network switch was rejected in your wallet");
    const switchMessage = providerErrorMessage(error);
    const addMessage = addError ? providerErrorMessage(addError) : "network add request completed";
    throw new Error(`Wallet could not activate Arc Testnet. Switch: ${switchMessage}. Add: ${addMessage}`);
  }
}

const SOURCE_NETWORKS: Record<EvmSourceChain, {
  chainId: number;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}> = {
  Base_Sepolia: {
    chainId: 84_532,
    chainName: "Base Sepolia",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  Arbitrum_Sepolia: {
    chainId: 421_614,
    chainName: "Arbitrum Sepolia",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.arbiscan.io"],
  },
  Ethereum_Sepolia: {
    chainId: 11_155_111,
    chainName: "Ethereum Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ETHEREUM_SEPOLIA_RPC_URLS,
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

/** Activate a source chain without replacing the user's existing RPC settings. */
export async function ensureGatewaySourceChain(provider: EIP1193Provider, sourceChain: EvmSourceChain) {
  const network = SOURCE_NETWORKS[sourceChain];
  const chainId = `0x${network.chainId.toString(16)}`;
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (Number(currentChainId) !== network.chainId) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if (isUserRejection(error)) throw new Error(`${network.chainName} network switch was rejected in your wallet`);
      if (Number(providerErrorCode(error)) !== 4902) throw new Error(`Wallet could not activate ${network.chainName}: ${providerErrorMessage(error)}`);
      try {
        await provider.request({ method: "wallet_addEthereumChain", params: [{ ...network, chainId }] });
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      } catch (addError) {
        if (isUserRejection(addError)) throw new Error(`${network.chainName} network request was rejected in your wallet`);
        throw new Error(`Wallet could not add ${network.chainName}: ${providerErrorMessage(addError)}`);
      }
    }
  }

  // Rabby can keep an integrated network on an unavailable RPC.
  // Probe its own transport before opening the signing
  // window so a broken endpoint becomes an actionable in-app message instead
  // of an oversized wallet error that blocks the transaction review.
  if (sourceChain === "Ethereum_Sepolia") {
    const accounts = await provider.request({ method: "eth_accounts", params: undefined }) as string[];
    if (accounts[0]) {
      try {
        await provider.request({ method: "eth_getTransactionCount", params: [accounts[0], "latest"] } as Parameters<EIP1193Provider["request"]>[0]);
      } catch (error) {
        const message = providerErrorMessage(error);
        if (/sepolia\.drpc\.org|chain is not available on free plan/i.test(message)) {
          throw new Error("Rabby's Ethereum Sepolia RPC rejected the request. In Rabby → Settings → Modify RPC URL → Sepolia, use https://ethereum-sepolia-rpc.publicnode.com, then retry. OffGrid cannot change Rabby's internal signing RPC.");
        }
      }
    }
  }
}

function providerErrorCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: number | string; cause?: unknown; data?: unknown; originalError?: unknown };
  return candidate.code ?? providerErrorCode(candidate.cause) ?? providerErrorCode(candidate.data) ?? providerErrorCode(candidate.originalError);
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return `provider error ${String(providerErrorCode(error) ?? "unknown")}`;
}

function isUserRejection(error: unknown) {
  const message = providerErrorMessage(error).toLowerCase();
  return providerErrorCode(error) === 4001 || message.includes("user rejected") || message.includes("user denied") || message.includes("request rejected");
}

const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }],
}] as const;

export async function readArcUsdcBalance(address: `0x${string}`, provider?: EIP1193Provider) {
  // Prefer the connected wallet transport in the browser. It uses the exact
  // Arc RPC configured in the wallet and avoids public-RPC CORS restrictions.
  const transport = provider ? custom(provider, { retryCount: 2 }) : http(ARC.rpcUrl, { retryCount: 2, timeout: 12_000 });
  const client = createPublicClient({ chain: arcTestnet, transport });
  const balance = await client.readContract({ address: ARC.contracts.usdc, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] });
  return formatUnits(balance, ARC.usdcDecimals);
}
