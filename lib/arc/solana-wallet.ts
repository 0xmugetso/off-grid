"use client";

import type { CreateSolanaAdapterFromProviderParams } from "@circle-fin/adapter-solana";

export type SolanaWalletProvider = CreateSolanaAdapterFromProviderParams["provider"];
export type SolanaBrowserWallet = { id: string; name: string; provider: SolanaWalletProvider };

declare global {
  interface Window {
    solana?: SolanaWalletProvider & { isPhantom?: boolean };
    phantom?: { solana?: SolanaWalletProvider };
    solflare?: SolanaWalletProvider;
    backpack?: SolanaWalletProvider | { solana?: SolanaWalletProvider };
  }
}

export function discoverSolanaWallets(): SolanaBrowserWallet[] {
  const backpack = window.backpack && "connect" in window.backpack ? window.backpack : window.backpack?.solana;
  const candidates: Array<SolanaBrowserWallet | null> = [
    window.phantom?.solana ? { id: "phantom", name: "Phantom", provider: window.phantom.solana } : null,
    window.solflare ? { id: "solflare", name: "Solflare", provider: window.solflare } : null,
    backpack ? { id: "backpack", name: "Backpack", provider: backpack } : null,
    window.solana ? { id: window.solana.isPhantom ? "phantom-injected" : "solana-injected", name: window.solana.isPhantom ? "Phantom" : "Solana Wallet", provider: window.solana } : null,
  ];
  const seen = new Set<SolanaWalletProvider>();
  return candidates.filter((candidate): candidate is SolanaBrowserWallet => {
    if (!candidate || seen.has(candidate.provider)) return false;
    seen.add(candidate.provider);
    return true;
  });
}

export function getSolanaWalletProvider(): SolanaWalletProvider | null {
  return discoverSolanaWallets()[0]?.provider ?? null;
}

export async function connectSolanaWallet(provider: SolanaWalletProvider) {
  const connection = await provider.connect();
  const address = connection.publicKey?.toString() ?? provider.publicKey?.toString();
  if (!address) throw new Error("The Solana wallet did not return an address");
  return address;
}

export async function disconnectSolanaWallet(provider: SolanaWalletProvider) {
  await provider.disconnect();
}
