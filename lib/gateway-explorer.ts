import type { SourceChain } from "@/lib/arc/config";

const EXPLORERS: Record<SourceChain, string> = {
  Base_Sepolia: "https://sepolia.basescan.org/tx/",
  Arbitrum_Sepolia: "https://sepolia.arbiscan.io/tx/",
  Ethereum_Sepolia: "https://sepolia.etherscan.io/tx/",
  Solana_Devnet: "https://explorer.solana.com/tx/",
  Arc_Testnet: "https://testnet.arcscan.app/tx/",
};

export function gatewayExplorerUrl(chain: SourceChain, txHash: string) {
  const base = `${EXPLORERS[chain]}${txHash}`;
  return chain === "Solana_Devnet" ? `${base}?cluster=devnet` : base;
}
