export const ARC = {
  name: "Arc Testnet",
  appKitId: "Arc_Testnet",
  chainId: 5_042_002,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  cctpDomain: 26,
  finalityMs: 480,
  nativeGasDecimals: 18,
  usdcDecimals: 6,
  contracts: {
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
    usycTeller: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A",
  },
} as const;

export const SOURCE_CHAINS = [
  "Base_Sepolia",
  "Arbitrum_Sepolia",
  "Ethereum_Sepolia",
  "Solana_Devnet",
  "Arc_Testnet",
] as const;

export type SourceChain = (typeof SOURCE_CHAINS)[number];

export const EVM_SOURCE_CHAINS = [
  "Base_Sepolia",
  "Arbitrum_Sepolia",
  "Ethereum_Sepolia",
] as const;

export type EvmSourceChain = (typeof EVM_SOURCE_CHAINS)[number];

export const CCTP_SOURCE_CHAINS = [...EVM_SOURCE_CHAINS, "Solana_Devnet"] as const;
export type CctpSourceChain = (typeof CCTP_SOURCE_CHAINS)[number];

export const CHAIN_LABELS: Record<SourceChain, string> = {
  Base_Sepolia: "Base Sepolia",
  Arbitrum_Sepolia: "Arbitrum Sepolia",
  Ethereum_Sepolia: "Ethereum Sepolia",
  Solana_Devnet: "Solana Devnet",
  Arc_Testnet: "Arc Testnet",
};

export const CCTP_TESTNET_DOMAINS: Record<SourceChain, number> = {
  Ethereum_Sepolia: 0,
  Arbitrum_Sepolia: 3,
  Solana_Devnet: 5,
  Base_Sepolia: 6,
  Arc_Testnet: ARC.cctpDomain,
};

/**
 * Arc exposes one USDC balance through two interfaces. Payments use the
 * 6-decimal ERC-20 view; only raw native gas accounting uses 18 decimals.
 */
export const assertPaymentDecimals = (decimals: number) => {
  if (decimals !== ARC.usdcDecimals) {
    throw new Error("OffGrid payment amounts must use 6-decimal USDC units");
  }
};
