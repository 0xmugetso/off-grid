import { describe, expect, it, vi } from "vitest";
import type { EIP1193Provider } from "viem";
import { ARC, CCTP_TESTNET_DOMAINS, assertPaymentDecimals } from "../lib/arc/config";
import { ensureArcTestnet } from "../lib/arc/browser-wallet";
import { getArcMintStep, validateMassPayouts } from "../lib/arc/app-kit-client";
import type { BridgeResult } from "@circle-fin/app-kit";
import { createInviteToken, hashInviteToken, paymentParties } from "../lib/payment-session-security";
import type { StoredPaymentSession } from "../lib/server/store";
import { formatUsdc, parseUsdc } from "../lib/money";
import { isSourceTransactionHash, isTransactionHash } from "../lib/transaction-hash";
import { isSubmittedCctpOperation, shouldPruneUnsignedCctpOperation } from "../lib/cctp-operations";

describe("USDC payment accounting", () => {
  it("round-trips the six-decimal ERC-20 representation", () => {
    expect(parseUsdc("31.400001")).toBe(31_400_001n);
    expect(formatUsdc(31_400_001n)).toBe("31.400001");
  });

  it("rejects accidental native-gas precision", () => {
    expect(() => parseUsdc("1.0000001")).toThrow("Invalid USDC amount");
    expect(() => assertPaymentDecimals(18)).toThrow("6-decimal USDC");
  });
});

describe("Arc Testnet configuration", () => {
  it("uses the official network and USDC interface", () => {
    expect(ARC.chainId).toBe(5_042_002);
    expect(ARC.nativeGasDecimals).toBe(18);
    expect(ARC.usdcDecimals).toBe(6);
    expect(ARC.contracts.usdc).toBe("0x3600000000000000000000000000000000000000");
  });

  it("adds Arc before switching for wallets that wrap unknown-chain errors", async () => {
    const calls: string[] = [];
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === "eth_chainId") return "0x1";
        if (method === "wallet_addEthereumChain") throw { code: -32603, data: { originalError: { code: 4902 } }, message: "Unrecognized chain" };
        if (method === "wallet_switchEthereumChain") return null;
        return null;
      }),
    } as unknown as EIP1193Provider;

    await expect(ensureArcTestnet(provider)).resolves.toBeUndefined();
    expect(calls).toEqual(["eth_chainId", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
  });

  it("preserves a wallet's user-rejection signal", async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x1";
        throw { code: 4001, message: "User rejected the request" };
      }),
    } as unknown as EIP1193Provider;
    await expect(ensureArcTestnet(provider)).rejects.toThrow("rejected in your wallet");
  });
});

describe("CCTP receipt selection", () => {
  it("uses Circle's official testnet domains for persistent Iris lookups", () => {
    expect(CCTP_TESTNET_DOMAINS).toMatchObject({ Ethereum_Sepolia: 0, Arbitrum_Sepolia: 3, Solana_Devnet: 5, Base_Sepolia: 6, Arc_Testnet: 26 });
  });

  it("uses the successful Arc mint rather than the source-chain burn", () => {
    const result = {
      state: "success",
      steps: [
        { name: "Burn", state: "success", txHash: `0x${"1".repeat(64)}`, explorerUrl: "https://sepolia.basescan.org/tx/source" },
        { name: "FetchAttestation", state: "success" },
        { name: "Mint", state: "success", txHash: `0x${"2".repeat(64)}`, explorerUrl: "https://testnet.arcscan.app/tx/destination" },
      ],
    } as BridgeResult;

    expect(getArcMintStep(result)?.name).toBe("Mint");
    expect(getArcMintStep(result)?.txHash).toBe(`0x${"2".repeat(64)}`);
  });

  it("persists both EVM hashes and Solana transaction signatures", () => {
    const evmHash = `0x${"a".repeat(64)}`;
    const solanaSignature = "5".repeat(88);
    expect(isTransactionHash(evmHash)).toBe(true);
    expect(isTransactionHash(solanaSignature)).toBe(true);
    expect(isSourceTransactionHash("Base_Sepolia", evmHash)).toBe(true);
    expect(isSourceTransactionHash("Solana_Devnet", solanaSignature)).toBe(true);
    expect(isSourceTransactionHash("Base_Sepolia", solanaSignature)).toBe(false);
  });

  it("keeps unsigned failures out of transaction history", () => {
    const failedPreflight = { burnTxHash: null, status: "failed" as const, updatedAt: new Date().toISOString() };
    expect(isSubmittedCctpOperation(failedPreflight)).toBe(false);
    expect(shouldPruneUnsignedCctpOperation(failedPreflight)).toBe(true);
  });

  it("never prunes a submitted burn, even when the bridge needs attention", () => {
    const submitted = { burnTxHash: `0x${"3".repeat(64)}`, status: "failed" as const, updatedAt: new Date(0).toISOString() };
    expect(isSubmittedCctpOperation(submitted)).toBe(true);
    expect(shouldPruneUnsignedCctpOperation(submitted)).toBe(false);
  });
});

describe("mass payroll validation", () => {
  const first = `0x${"1".repeat(40)}`;
  const second = `0x${"2".repeat(40)}`;

  it("normalizes recipients and preserves six-decimal amounts", () => {
    const payouts = validateMassPayouts([{ recipientAddress: first, amount: "1250.400001" }, { recipientAddress: second, amount: "80.00" }]);
    expect(payouts.map((payout) => payout.rawAmount)).toEqual([1_250_400_001n, 80_000_000n]);
  });

  it("rejects duplicate wallets and zero-value payroll entries", () => {
    expect(() => validateMassPayouts([{ recipientAddress: first, amount: "1" }, { recipientAddress: first, amount: "2" }])).toThrow("appears more than once");
    expect(() => validateMassPayouts([{ recipientAddress: first, amount: "0" }])).toThrow("greater than zero");
  });
});

describe("private payment sessions", () => {
  it("uses non-enumerable 256-bit capability tokens and stores only their hash", () => {
    const first = createInviteToken();
    const second = createInviteToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(hashInviteToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken(first)).not.toContain(first);
  });

  it("derives payer and receiver from the creator's declared direction", () => {
    const base = { creatorId: "creator", counterpartyId: "invitee", creatorRail: "web3_usdc", counterpartyRail: "fiat_bank" } as StoredPaymentSession;
    expect(paymentParties({ ...base, creatorIntent: "pay" })).toMatchObject({ payerId: "creator", receiverId: "invitee", payerRail: "web3_usdc", receiverRail: "fiat_bank" });
    expect(paymentParties({ ...base, creatorIntent: "receive" })).toMatchObject({ payerId: "invitee", receiverId: "creator", payerRail: "fiat_bank", receiverRail: "web3_usdc" });
  });
});
