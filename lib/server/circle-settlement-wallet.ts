import "server-only";

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, decodeEventLog, getAddress, http, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC } from "@/lib/arc/config";

const transferEvent = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

function config() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim() || "";
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim() || "";
  const walletId = process.env.CIRCLE_SETTLEMENT_WALLET_ID?.trim() || process.env.CIRCLE_ESCROW_AGENT_WALLET_ID?.trim() || "";
  const address = process.env.CIRCLE_SETTLEMENT_WALLET_ADDRESS?.trim() || process.env.CIRCLE_ESCROW_AGENT_ADDRESS?.trim() || "";
  if (!apiKey || !entitySecret || !walletId || !address) {
    throw new Error("The developer settlement wallet is not configured");
  }
  return { apiKey, entitySecret, walletId, address };
}

function client() {
  const values = config();
  return { values, wallets: initiateDeveloperControlledWalletsClient({ apiKey: values.apiKey, entitySecret: values.entitySecret }) };
}

export function settlementWalletStatus() {
  const walletId = process.env.CIRCLE_SETTLEMENT_WALLET_ID?.trim() || process.env.CIRCLE_ESCROW_AGENT_WALLET_ID?.trim() || "";
  const address = process.env.CIRCLE_SETTLEMENT_WALLET_ADDRESS?.trim() || process.env.CIRCLE_ESCROW_AGENT_ADDRESS?.trim() || "";
  return { configured: Boolean(process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET && walletId && address), address };
}

export async function createSettlementWalletTransfer(input: {
  idempotencyKey: string;
  destinationAddress: string;
  amount: string;
  reference: string;
}) {
  const { values, wallets } = client();
  const wallet = await wallets.getWallet({ id: values.walletId });
  if (!wallet.data?.wallet?.address || wallet.data.wallet.address.toLowerCase() !== values.address.toLowerCase()) {
    throw new Error("The configured settlement wallet ID and address do not match");
  }
  const balances = await wallets.getWalletTokenBalance({ id: values.walletId, tokenAddresses: [ARC.contracts.usdc] });
  const usdc = balances.data?.tokenBalances?.find((entry) => entry.token?.tokenAddress?.toLowerCase() === ARC.contracts.usdc.toLowerCase());
  if (!usdc?.token?.id) throw new Error("Circle could not resolve Arc Testnet USDC in the settlement wallet");
  if (Number(usdc.amount || "0") < Number(input.amount)) throw new Error("The settlement wallet has not received enough Arc Testnet USDC yet");
  const response = await wallets.createTransaction({
    idempotencyKey: input.idempotencyKey,
    walletId: values.walletId,
    destinationAddress: input.destinationAddress,
    tokenId: usdc.token.id,
    amount: [input.amount],
    refId: input.reference.slice(0, 36),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const transaction = response.data;
  if (!transaction?.id) throw new Error("Circle did not return a settlement transaction ID");
  return {
    id: transaction.id,
    state: transaction.state || "INITIATED",
    sourceAddress: values.address,
    sourceBalanceBefore: usdc.amount || "0",
  };
}

export async function getSettlementWalletTransfer(id: string) {
  const { wallets } = client();
  const response = await wallets.getTransaction({ id });
  const transaction = response.data?.transaction;
  if (!transaction) throw new Error("The settlement wallet transaction was not found");
  return {
    state: transaction.state || "UNKNOWN",
    txHash: transaction.txHash || null,
    errorReason: transaction.errorReason || null,
  };
}

export async function verifySettlementWalletTransfer(input: {
  txHash: `0x${string}`;
  destinationAddress: `0x${string}`;
  amount: string;
}) {
  const { values } = client();
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC.rpcUrl, { retryCount: 3, timeout: 15_000 }),
  });
  const receipt = await publicClient.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") throw new Error("The Arc Testnet settlement transaction reverted");
  const expectedFrom = getAddress(values.address);
  const expectedTo = getAddress(input.destinationAddress);
  const expectedAmount = parseUnits(input.amount, ARC.usdcDecimals);
  const matchedTransfer = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== ARC.contracts.usdc.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics });
      return decoded.eventName === "Transfer"
        && getAddress(decoded.args.from) === expectedFrom
        && getAddress(decoded.args.to) === expectedTo
        && decoded.args.value === expectedAmount;
    } catch {
      return false;
    }
  });
  if (!matchedTransfer) throw new Error("The testnet transaction did not contain the expected USDC transfer");
  return { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
}
