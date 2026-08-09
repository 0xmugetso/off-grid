import "server-only";

import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { initiateSmartContractPlatformClient, type Blockchain } from "@circle-fin/smart-contract-platform";
import artifact from "@/lib/generated/refund-protocol-artifact.json";
import { ARC } from "@/lib/arc/config";
import { mutateDatabase, queryDatabase, type StoredUser } from "@/lib/server/store";
import { escrowAiConfiguration } from "@/lib/server/escrow-ai";

const ESCROW_BLOCKCHAIN = "ARC-TESTNET" as Blockchain;

function requiredConfig() {
  const values = {
    apiKey: process.env.CIRCLE_API_KEY?.trim() || "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET?.trim() || "",
    agentWalletId: process.env.CIRCLE_ESCROW_AGENT_WALLET_ID?.trim() || "",
    agentAddress: process.env.CIRCLE_ESCROW_AGENT_ADDRESS?.trim() || "",
  };
  const environmentNames: Record<keyof typeof values, string> = {
    apiKey: "CIRCLE_API_KEY",
    entitySecret: "CIRCLE_ENTITY_SECRET",
    agentWalletId: "CIRCLE_ESCROW_AGENT_WALLET_ID",
    agentAddress: "CIRCLE_ESCROW_AGENT_ADDRESS",
  };
  const missing = (Object.keys(values) as Array<keyof typeof values>)
    .filter((key) => !values[key])
    .map((key) => environmentNames[key]);
  return { ...values, missing };
}

export function circleEscrowConfiguration() {
  const config = requiredConfig();
  return {
    configured: config.missing.length === 0,
    missing: config.missing,
    blockchain: ESCROW_BLOCKCHAIN,
    usdcAddress: ARC.contracts.usdc,
    contractSource: artifact.source,
    ai: escrowAiConfiguration(),
  };
}

function clients() {
  const config = requiredConfig();
  if (config.missing.length) {
    throw new Error(`Circle escrow is not configured (${config.missing.join(", ")})`);
  }
  return {
    config,
    wallets: initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    }),
    contracts: initiateSmartContractPlatformClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    }),
  };
}

/** Convert SDK/proxy failures into an actionable message. Circle can return
 * an HTML gateway page when a key, entity secret, or wallet id is invalid. */
function circleError(error: unknown, operation: string) {
  if (error instanceof Error && error.message && !error.message.includes("<!DOCTYPE")) {
    return new Error(`${operation}: ${error.message}`);
  }
  const record = error as { response?: { data?: { message?: string; error?: string } }; message?: string } | null;
  const detail = record?.response?.data?.message || record?.response?.data?.error || record?.message;
  return new Error(`${operation}: ${detail || "Circle returned an invalid response. Verify CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and the escrow agent wallet settings."}`);
}

export async function ensureCircleEscrowWallet(userId: string) {
  const existing = await queryDatabase((database) => database.users.find((user) => user.id === userId) ?? null);
  if (!existing) throw new Error("Escrow participant account not found");
  if (existing.circleWalletId && existing.circleWalletAddress && existing.circleWalletSetId) {
    return {
      walletSetId: existing.circleWalletSetId,
      walletId: existing.circleWalletId,
      address: existing.circleWalletAddress,
    };
  }

  const { wallets } = clients();
  const walletSetResponse = await wallets.createWalletSet({
    idempotencyKey: randomUUID(),
    name: `OffGrid Escrow · ${existing.username}`.slice(0, 50),
  });
  const walletSetId = walletSetResponse.data?.walletSet?.id;
  if (!walletSetId) throw new Error("Circle did not return an escrow wallet set");

  const walletResponse = await wallets.createWallets({
    idempotencyKey: randomUUID(),
    accountType: "SCA",
    blockchains: [ESCROW_BLOCKCHAIN],
    count: 1,
    walletSetId,
    metadata: [{ name: `OffGrid Escrow · ${existing.username}`, refId: existing.id }],
  });
  const wallet = walletResponse.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) throw new Error("Circle did not return an Arc escrow wallet");

  await mutateDatabase((database) => {
    const user = database.users.find((entry) => entry.id === userId);
    if (!user) throw new Error("Escrow participant account disappeared while provisioning");
    user.circleWalletSetId = walletSetId;
    user.circleWalletId = wallet.id;
    user.circleWalletAddress = wallet.address;
  });

  return { walletSetId, walletId: wallet.id, address: wallet.address };
}

export async function deployRefundProtocol(name: string) {
  try {
    const { contracts, config } = clients();
    const response = await contracts.deployContract({
      idempotencyKey: randomUUID(),
      name: `OffGrid · ${name}`.slice(0, 50),
      description: "Circle RefundProtocol escrow deployed by OffGrid on Arc Testnet",
      walletId: config.agentWalletId,
      blockchain: ESCROW_BLOCKCHAIN,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      constructorParameters: [config.agentAddress, ARC.contracts.usdc, "EscrowProtocol", "1.0"],
      abiJson: JSON.stringify(artifact.abi),
      bytecode: artifact.bytecode,
    });
    if (!response.data?.contractId || !response.data.transactionId) {
      throw new Error("Circle did not return the RefundProtocol deployment identifiers");
    }
    return { contractId: response.data.contractId, transactionId: response.data.transactionId };
  } catch (error) {
    throw circleError(error, "RefundProtocol deployment failed");
  }
}

export async function executeEscrowContract(input: {
  walletId: string;
  contractAddress: string;
  signature: string;
  parameters: Array<string | number | boolean | Array<number>>;
}) {
  const { wallets } = clients();
  const response = await wallets.createContractExecutionTransaction({
    idempotencyKey: randomUUID(),
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.signature,
    abiParameters: input.parameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  if (!response.data?.id) throw new Error("Circle did not return a contract transaction ID");
  return { id: response.data.id, state: response.data.state || "INITIATED" };
}

export async function getCircleEscrowTransaction(id: string) {
  const { wallets } = clients();
  const response = await wallets.getTransaction({ id });
  const transaction = response.data?.transaction;
  if (!transaction) throw new Error("Circle transaction was not found");
  return {
    state: transaction.state || "UNKNOWN",
    txHash: transaction.txHash || undefined,
    contractAddress: transaction.contractAddress || undefined,
    errorReason: transaction.errorReason || undefined,
  };
}

export async function getRefundProtocolContract(id: string) {
  const { contracts } = clients();
  const response = await contracts.getContract({ id });
  return response.data?.contract?.contractAddress || undefined;
}

export async function getCircleEscrowWalletBalance(walletId: string) {
  const { wallets } = clients();
  const response = await wallets.getWalletTokenBalance({
    id: walletId,
    tokenAddresses: [ARC.contracts.usdc],
  });
  const token = response.data?.tokenBalances?.find((entry) => entry.token?.tokenAddress?.toLowerCase() === ARC.contracts.usdc.toLowerCase());
  return token?.amount || "0";
}

export function circleEscrowUserView(user: StoredUser) {
  return user.circleWalletId && user.circleWalletAddress
    ? { walletId: user.circleWalletId, address: user.circleWalletAddress }
    : null;
}
