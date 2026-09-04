import {
  AppKit,
  isRetryableError,
  type AdapterContext,
  type BridgeResult,
  type BridgeStep,
  type SendParams,
} from "@circle-fin/app-kit";
import { ArbitrumSepolia, ArcTestnet, BaseSepolia, EthereumSepolia, SolanaDevnet } from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider, resolveChainIdentifier, type ViemAdapter } from "@circle-fin/adapter-viem-v2";
import { createSolanaAdapterFromProvider, type SolanaAdapter } from "@circle-fin/adapter-solana";
import { Connection } from "@solana/web3.js";
import { createPublicClient, fallback, getAddress, http, isAddress, type Chain } from "viem";
import type { EIP1193Provider } from "viem";
import { arbitrumSepolia, arcTestnet, baseSepolia, sepolia } from "viem/chains";
import type { CctpSourceChain, EvmSourceChain, SourceChain } from "./config";
import { ARC } from "./config";
import type { SolanaWalletProvider } from "./solana-wallet";
import { formatUsdc, parseUsdc } from "../money";

export type ArcEventListener = (payload: unknown) => void;
export type CctpSourceSubmission = { traceId: string; txHash: string };
export type CircleAdapter = AdapterContext["adapter"];
// The factory preserves the literal readonly supported-chain tuple in its
// generic result, so the UI boundary intentionally erases only that tuple.
export type BrowserViemAdapter = ViemAdapter<any>;
export type BrowserSolanaAdapter = SolanaAdapter;
export type MassPayout = { recipientAddress: string; amount: string };
export type MassPaymentResult = {
  mode: "wallet_batch" | "sequential" | "gateway_sequential";
  txHashes: string[];
  explorerUrls: Array<string | undefined>;
  batchId?: string;
  partial?: boolean;
  errorMessage?: string;
};
export type GatewayMintRetry = { attestation: string; signature: string };

function gatewaySpendSources(adapters: CircleAdapter[]) {
  if (!adapters.length) throw new Error("Connect an EVM wallet before using Unified Balance");
  // Preserve Circle's original single-adapter sample shape. Use an array only
  // when the Solana source is actually participating in the spend.
  return adapters.length === 1 ? { adapter: adapters[0] } : adapters.map((adapter) => ({ adapter }));
}

const usdcTransferAbi = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "success", type: "bool" }],
}] as const;

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
const ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111;

const ARC_TESTNET_PUBLIC_FALLBACK = "https://rpc.testnet.arc.io";
const ARC_TESTNET_SECONDARY_FALLBACK = "https://rpc.testnet.arc.network";

function publicTransportFor(chain: Chain) {
  if (chain.id === ARC.chainId) {
    const urls = Array.from(new Set([
      process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim(),
      ARC_TESTNET_PUBLIC_FALLBACK,
      ARC_TESTNET_SECONDARY_FALLBACK,
      chain.rpcUrls.default.http[0],
    ].filter((url): url is string => Boolean(url))));
    return fallback(
      urls.map((url) => http(url, { retryCount: 2, retryDelay: 250, timeout: 15_000 })),
      { retryCount: 2, retryDelay: 300 },
    );
  }

  let rpcUrls: string[] = [];

  if (chain.id === BASE_SEPOLIA_CHAIN_ID) {
    rpcUrls = [
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim(),
      "https://sepolia.base.org",
      "https://base-sepolia-rpc.publicnode.com",
      "https://base-sepolia.blockpi.network/v1/rpc/public",
    ].filter((url): url is string => Boolean(url));
  } else if (chain.id === ARBITRUM_SEPOLIA_CHAIN_ID) {
    rpcUrls = [
      process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL?.trim(),
      "https://sepolia-rollup.arbitrum.io/rpc",
      "https://arbitrum-sepolia-rpc.publicnode.com",
    ].filter((url): url is string => Boolean(url));
  } else if (chain.id === ETHEREUM_SEPOLIA_CHAIN_ID) {
    rpcUrls = [
      process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL?.trim(),
      "https://rpc.sepolia.org",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ].filter((url): url is string => Boolean(url));
  } else {
    rpcUrls = [chain.rpcUrls.default.http[0]].filter(Boolean);
  }

  const uniqueUrls = Array.from(new Set(rpcUrls));

  return fallback(
    uniqueUrls.map((url) => http(url, { retryCount: 2, retryDelay: 300, timeout: 12_000 })),
    { retryCount: 2, retryDelay: 300 },
  );
}

const VIEM_CHAIN_BY_ID = new Map<number, Chain>([
  [baseSepolia.id, baseSepolia],
  [arbitrumSepolia.id, arbitrumSepolia],
  [sepolia.id, sepolia],
  [arcTestnet.id, arcTestnet],
]);

// Browser wallets should remain the signer, not the source of truth for public
// chain reads. Some wallets still ship an Ethereum Sepolia network backed by
// sepolia.drpc.org, which no longer serves that chain on its free plan. App Kit
// may request a nonce or fee through the wallet client while preparing an
// approval or deposit, so route those read-only methods through the same
// chain-specific fallback transport used by the App Kit public client.
const PUBLIC_RPC_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

export function isCctpBurnSubmissionData(data: string) {
  return /^0x[a-fA-F0-9]{8,}$/.test(data) && !data.toLowerCase().startsWith(ERC20_APPROVE_SELECTOR);
}

function withReliablePublicReads(provider: EIP1193Provider, onTransactionSubmitted?: (txHash: string, data: string) => void): EIP1193Provider {
  return {
    on: provider.on.bind(provider),
    removeListener: provider.removeListener.bind(provider),
    request: (async (request: { method: string; params?: unknown }) => {
      if (request.method === "eth_sendTransaction") {
        const currentChainId = await provider.request({ method: "eth_chainId" });
        const numericChainId = typeof currentChainId === "string" ? Number.parseInt(currentChainId, 16) : Number(currentChainId);
        const chain = VIEM_CHAIN_BY_ID.get(numericChainId);
        const params = Array.isArray(request.params) ? request.params : [];
        const transaction = params[0];

        if (chain && transaction && typeof transaction === "object") {
          const publicClient = createPublicClient({ chain, transport: publicTransportFor(chain) });
          const rpc = publicClient as unknown as {
            request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
          };
          const prepared = { ...(transaction as Record<string, unknown>) };
          const from = typeof prepared.from === "string" ? prepared.from : "";

          // Give the signer every public-chain value it needs up front. Rabby
          // otherwise asks its saved network RPC for the nonce and gas while
          // opening the confirmation screen. Some existing Sepolia profiles
          // still point at the retired sepolia.drpc.org free endpoint.
          if (from && prepared.nonce === undefined) {
            prepared.nonce = await rpc.request({ method: "eth_getTransactionCount", params: [from, "pending"] });
          }
          if (prepared.gas === undefined) {
            const estimate = await rpc.request({ method: "eth_estimateGas", params: [prepared] });
            if (typeof estimate === "string") {
              prepared.gas = `0x${((BigInt(estimate) * 120n) / 100n).toString(16)}`;
            }
          }
          if (prepared.gasPrice === undefined && prepared.maxFeePerGas === undefined) {
            prepared.gasPrice = await rpc.request({ method: "eth_gasPrice" });
          }
          prepared.chainId ??= `0x${chain.id.toString(16)}`;

          const result = await provider.request({ ...request, params: [prepared, ...params.slice(1)] } as Parameters<EIP1193Provider["request"]>[0]);
          const data = typeof prepared.data === "string" ? prepared.data : "";
          if (typeof result === "string" && /^0x[a-fA-F0-9]{64}$/.test(result) && isCctpBurnSubmissionData(data)) {
            onTransactionSubmitted?.(result, data);
          }
          return result;
        }
      }

      if (!PUBLIC_RPC_METHODS.has(request.method)) {
        return provider.request(request as Parameters<EIP1193Provider["request"]>[0]);
      }

      const currentChainId = await provider.request({ method: "eth_chainId" });
      const numericChainId = typeof currentChainId === "string" ? Number.parseInt(currentChainId, 16) : Number(currentChainId);
      const chain = VIEM_CHAIN_BY_ID.get(numericChainId);
      if (!chain) return provider.request(request as Parameters<EIP1193Provider["request"]>[0]);

      const publicClient = createPublicClient({ chain, transport: publicTransportFor(chain) });
      return publicClient.request(request as Parameters<typeof publicClient.request>[0]);
    }) as EIP1193Provider["request"],
  };
}

export function validateMassPayouts(payouts: MassPayout[]) {
  if (!payouts.length) throw new Error("Add at least one team member");
  if (payouts.length > 50) throw new Error("A payroll run is limited to 50 recipients");
  const seen = new Set<string>();
  return payouts.map((payout, index) => {
    if (!isAddress(payout.recipientAddress)) throw new Error(`Team member ${index + 1} has an invalid wallet`);
    const recipientAddress = getAddress(payout.recipientAddress);
    const normalized = recipientAddress.toLowerCase();
    if (seen.has(normalized)) throw new Error(`Wallet ${recipientAddress} appears more than once`);
    seen.add(normalized);
    const amount = parseUsdc(payout.amount);
    if (amount <= 0n) throw new Error(`Team member ${index + 1} needs an amount greater than zero`);
    return { recipientAddress, amount: payout.amount, rawAmount: amount };
  });
}

/**
 * Thin integration boundary around Circle App Kit. UI code depends on this
 * class rather than protocol-specific burn/attestation/mint steps.
 */
export class ArcPayrollClient {
  private readonly kit = new AppKit({ disableErrorReporting: true });
  private readonly cctpSubmissionListeners = new Set<(submission: CctpSourceSubmission) => void>();
  private activeCctpTraceId: string | null = null;

  onProgress(listener: ArcEventListener) {
    this.kit.on("*", listener);
    return () => this.kit.off("*", listener);
  }

  onCctpSourceSubmitted(listener: (submission: CctpSourceSubmission) => void) {
    this.cctpSubmissionListeners.add(listener);
    return () => this.cctpSubmissionListeners.delete(listener);
  }

  private captureCctpSourceSubmission(txHash: string) {
    const traceId = this.activeCctpTraceId;
    if (!traceId) return;
    this.activeCctpTraceId = null;
    for (const listener of this.cctpSubmissionListeners) listener({ traceId, txHash });
  }

  connectEvmWallet(provider: EIP1193Provider) {
    return createViemAdapterFromProvider({
      provider: withReliablePublicReads(provider, (txHash) => this.captureCctpSourceSubmission(txHash)),
      // Public reads must stay chain-specific because App Kit can query several
      // chains without moving the wallet away from the user's signing chain.
      getPublicClient: ({ chain }) => createPublicClient({
        chain,
        transport: publicTransportFor(chain),
      }),
      capabilities: {
        supportedChains: [BaseSepolia, ArbitrumSepolia, EthereumSepolia, ArcTestnet],
      },
    });
  }

  connectSolanaWallet(provider: SolanaWalletProvider) {
    // Keep Solana reads same-origin. Public Devnet RPCs are frequently rate
    // limited and some browser/privacy setups block their cross-origin calls.
    // The server proxy also lets deployments use a private RPC key safely.
    const endpoint = typeof window === "undefined"
      ? "http://localhost/api/solana/rpc"
      : new URL("/api/solana/rpc", window.location.origin).toString();
    return createSolanaAdapterFromProvider({
      provider,
      connection: new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: false }),
    });
  }

  async getSolanaUsdcBalance(adapter: BrowserSolanaAdapter, walletAddress: string) {
    const prepared = await adapter.prepareAction("usdc.balanceOf", { walletAddress }, { chain: SolanaDevnet, address: walletAddress });
    return formatUsdc(BigInt(await prepared.execute()));
  }

  async deposit(adapter: CircleAdapter, chain: SourceChain, amount: string) {
    if (chain !== "Solana_Devnet") {
      const resolvedChain = resolveChainIdentifier(chain);
      if (resolvedChain.type === "evm") await (adapter as BrowserViemAdapter).ensureChain(resolvedChain);
    }
    return this.kit.unifiedBalance.deposit({
      from: { adapter, chain },
      amount,
      token: "USDC",
    });
  }

  estimateArcSend(adapter: CircleAdapter, recipientAddress: string, amount: string) {
    const params: SendParams = { from: { adapter, chain: "Arc_Testnet" }, to: recipientAddress, amount, token: "USDC" };
    return this.kit.estimateSend(params);
  }

  sendArcUsdc(adapter: CircleAdapter, recipientAddress: string, amount: string) {
    const params: SendParams = { from: { adapter, chain: "Arc_Testnet" }, to: recipientAddress, amount, token: "USDC" };
    return this.kit.send(params);
  }

  getUnifiedBalance(adapters: CircleAdapter[]) {
    return this.kit.unifiedBalance.getBalances({
      sources: adapters.map((adapter) => ({ adapter })),
      networkType: "testnet",
      includePending: true,
    });
  }

  settlePayrollToArc(adapters: CircleAdapter[], recipientAddress: string, amount: string, destinationAdapter: CircleAdapter = adapters[0]) {
    if (!destinationAdapter) throw new Error("Connect an EVM wallet before spending from Unified Balance");
    return this.kit.unifiedBalance.spend({
      from: gatewaySpendSources(adapters),
      amount,
      token: "USDC",
      to: {
        adapter: destinationAdapter,
        chain: "Arc_Testnet",
        recipientAddress,
      },
    });
  }

  retryGatewayMint(destinationAdapter: CircleAdapter, recipientAddress: string, amount: string, retry: GatewayMintRetry) {
    return this.kit.unifiedBalance.spend({
      amount,
      token: "USDC",
      to: { adapter: destinationAdapter, chain: "Arc_Testnet", recipientAddress },
      config: { retry },
    });
  }

  async massPayArc(adapter: BrowserViemAdapter, payouts: MassPayout[]): Promise<MassPaymentResult> {
    const validated = validateMassPayouts(payouts);
    const resolvedArc = resolveChainIdentifier("Arc_Testnet");
    if (resolvedArc.type !== "evm") throw new Error("Arc Testnet did not resolve as an EVM chain");
    await adapter.ensureChain(resolvedArc);

    const prepared = await Promise.all(validated.map((payout) => adapter.prepare({
      type: "evm",
      address: ARC.contracts.usdc,
      abi: usdcTransferAbi,
      functionName: "transfer",
      args: [payout.recipientAddress, payout.rawAmount],
    }, { chain: "Arc_Testnet" })));

    if (await adapter.supportsAtomicBatch(ArcTestnet)) {
      const calls = prepared.map((request) => {
        const call = request.getCallData?.();
        if (!call) throw new Error("The connected wallet adapter cannot prepare batch calldata");
        return call;
      });
      const result = await adapter.batchExecute(calls, ArcTestnet);
      if (!result.receipts.length) throw new Error(`Wallet batch ${result.batchId} was submitted, but confirmation status is not available yet. Do not submit it again.`);
      const failed = result.receipts.find((receipt) => receipt.status !== "success");
      if (failed) throw new Error("One or more calls in the wallet batch failed");
      return {
        mode: "wallet_batch",
        batchId: result.batchId,
        txHashes: result.receipts.map((receipt) => receipt.txHash),
        explorerUrls: result.receipts.map((receipt) => `${ARC.explorerUrl}/tx/${receipt.txHash}`),
      };
    }

    const txHashes: string[] = [];
    try {
      for (const request of prepared) {
        const txHash = await request.execute() as `0x${string}`;
        let receipt;
        try {
          receipt = await adapter.waitForTransaction(txHash, { confirmations: 1, timeout: 120_000 }, ArcTestnet);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "confirmation timed out";
          throw new Error(`Transaction ${txHash} was submitted but could not be confirmed (${reason}). Check Arcscan before retrying this recipient.`);
        }
        if (receipt.status !== "success") {
          throw new Error(`Transaction ${txHash} reverted. This recipient was not paid.`);
        }
        txHashes.push(txHash);
      }
    } catch (error) {
      if (!txHashes.length) throw error;
      return {
        mode: "sequential",
        txHashes,
        explorerUrls: txHashes.map((hash) => `${ARC.explorerUrl}/tx/${hash}`),
        partial: true,
        errorMessage: error instanceof Error ? error.message : "The wallet stopped the sequential payroll run",
      };
    }
    return {
      mode: "sequential",
      txHashes,
      explorerUrls: txHashes.map((hash) => `${ARC.explorerUrl}/tx/${hash}`),
    };
  }

  async massPayUnified(adapters: CircleAdapter[], payouts: MassPayout[], onProgress?: (completed: number, total: number) => void, destinationAdapter: CircleAdapter = adapters[0]): Promise<MassPaymentResult> {
    if (!destinationAdapter) throw new Error("Connect an EVM wallet before running Gateway payroll");
    const validated = validateMassPayouts(payouts);
    const txHashes: string[] = [];
    const explorerUrls: Array<string | undefined> = [];
    try {
      for (let index = 0; index < validated.length; index += 1) {
        const payout = validated[index];
        const result = await this.kit.unifiedBalance.spend({
          from: gatewaySpendSources(adapters),
          amount: payout.amount,
          token: "USDC",
          to: { adapter: destinationAdapter, chain: "Arc_Testnet", recipientAddress: payout.recipientAddress },
        });
        txHashes.push(result.txHash);
        explorerUrls.push(result.explorerUrl);
        onProgress?.(index + 1, validated.length);
      }
    } catch (error) {
      if (!txHashes.length) throw error;
      return {
        mode: "gateway_sequential",
        txHashes,
        explorerUrls,
        partial: true,
        errorMessage: error instanceof Error ? error.message : "Gateway stopped the payroll run",
      };
    }
    return { mode: "gateway_sequential", txHashes, explorerUrls };
  }

  estimatePayrollToArc(adapters: CircleAdapter[], recipientAddress: string, amount: string, destinationAdapter: CircleAdapter = adapters[0]) {
    if (!destinationAdapter) throw new Error("Connect an EVM wallet before checking the Gateway route");
    return this.kit.unifiedBalance.estimateSpend({
      from: gatewaySpendSources(adapters),
      amount,
      token: "USDC",
      to: { adapter: destinationAdapter, chain: "Arc_Testnet", recipientAddress },
    });
  }

  async estimateBridgeToArc(sourceAdapter: CircleAdapter, sourceChain: CctpSourceChain, recipientAddress: string, amount: string) {
    if (sourceChain !== "Solana_Devnet") {
      const resolvedChain = resolveChainIdentifier(sourceChain as EvmSourceChain);
      if (resolvedChain.type !== "evm") throw new Error(`${sourceChain} is not an EVM chain`);
      await (sourceAdapter as BrowserViemAdapter).ensureChain(resolvedChain);
    }
    return this.kit.estimateBridge({
      from: { adapter: sourceAdapter, chain: sourceChain },
      to: { chain: "Arc_Testnet", recipientAddress, useForwarder: true },
      amount,
      token: "USDC",
      config: { transferSpeed: "SLOW" },
    });
  }

  bridgeToArc(sourceAdapter: CircleAdapter, sourceChain: CctpSourceChain, recipientAddress: string, amount: string, traceId: string) {
    this.activeCctpTraceId = traceId;
    return this.kit.bridge({
      from: { adapter: sourceAdapter, chain: sourceChain },
      to: { chain: "Arc_Testnet", recipientAddress, useForwarder: true },
      amount,
      token: "USDC",
      invocationMeta: { traceId, callers: [{ type: "app", name: "OffGrid", version: "0.1.0" }] },
      // Standard CCTPv2 uses hard finality; Circle Forwarder completes the Arc mint.
      // Sequential EVM execution exposes the source burn hash as soon as the
      // wallet submits it, allowing the UI to hand long attestation/mint work
      // to the persisted History tracker instead of holding the payment form.
      config: { transferSpeed: "SLOW", batchTransactions: false },
    }).finally(() => {
      if (this.activeCctpTraceId === traceId) this.activeCctpTraceId = null;
    });
  }

  retryBridge(result: BridgeResult, sourceAdapter: CircleAdapter) {
    const failedStep = result.steps.find((step) => step.state === "error");
    if (!failedStep?.error || !isRetryableError(failedStep.error)) return Promise.resolve(result);
    return this.kit.retryBridge(result, { from: sourceAdapter });
  }
}

export function getArcMintStep(result: BridgeResult): BridgeStep | null {
  const successful = result.steps.filter((step) => step.state === "success" && step.txHash);
  return successful.findLast((step) => step.name.toLowerCase().includes("mint"))
    ?? successful.findLast((step) => step.explorerUrl?.includes("arcscan"))
    ?? null;
}
