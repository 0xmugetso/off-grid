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
  const entitySecretFormatValid = /^[a-fA-F0-9]{64}$/.test(config.entitySecret);
  return {
    configured: config.missing.length === 0 && entitySecretFormatValid,
    missing: entitySecretFormatValid ? config.missing : [...config.missing, "CIRCLE_ENTITY_SECRET (64-char registered hex secret)"],
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
    const candidate = error as Error & { response?: { data?: unknown; status?: number }; cause?: unknown; toJSON?: () => unknown };
    const nested = candidate.cause as { response?: { data?: unknown; status?: number } } | undefined;
    const serialized = typeof candidate.toJSON === "function" ? candidate.toJSON() as { response?: { data?: unknown; status?: number } } : undefined;
    const payload = candidate.response?.data ?? nested?.response?.data ?? serialized?.response?.data;
    if (payload && typeof payload === "object") {
      const details = payload as { message?: string; error?: string; code?: string; errors?: Array<{ message?: string }>; data?: { message?: string } };
      const detail = details.message || details.error || details.data?.message || details.errors?.map((entry) => entry.message).filter(Boolean).join("; ");
      if (detail) return new Error(`${operation}: ${detail} (${error.message})`);
    }
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
  const safeName = `OffGridEscrow${existing.username}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50) || "OffGridEscrow";
  let walletSetResponse;
  try {
    walletSetResponse = await wallets.createWalletSet({
      idempotencyKey: randomUUID(),
      name: safeName,
    });
  } catch (error) {
    throw circleError(error, "Escrow wallet-set creation failed");
  }
  const walletSetId = walletSetResponse.data?.walletSet?.id;
  if (!walletSetId) throw new Error("Circle did not return an escrow wallet set");

  let walletResponse;
  try {
    walletResponse = await wallets.createWallets({
      idempotencyKey: randomUUID(),
      accountType: "SCA",
      blockchains: [ESCROW_BLOCKCHAIN],
      count: 1,
      walletSetId,
      metadata: [{ name: safeName, refId: existing.id }],
    });
  } catch (error) {
    throw circleError(error, "Escrow SCA wallet creation failed");
  }
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
    if (!/^0x[a-fA-F0-9]{40}$/.test(config.agentAddress)) {
      throw new Error("CIRCLE_ESCROW_AGENT_ADDRESS is not a valid EVM address");
    }
    // Circle deploys from the dedicated agent SCA, not the user's browser
    // wallet. A zero balance is otherwise reported by the API as a generic
    // HTTP 400 because Arc uses USDC as its gas token.
    const wallets = initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });
    const walletResponse = await wallets.getWallet({ id: config.agentWalletId });
    const agentWallet = walletResponse.data?.wallet;
    if (!agentWallet?.address) {
      throw new Error("CIRCLE_ESCROW_AGENT_WALLET_ID was not found in the configured Circle account");
    }
    if (agentWallet.address.toLowerCase() !== config.agentAddress.toLowerCase()) {
      throw new Error("CIRCLE_ESCROW_AGENT_ADDRESS does not match the configured Circle agent wallet ID");
    }
    if (agentWallet.blockchain && agentWallet.blockchain !== ESCROW_BLOCKCHAIN) {
      throw new Error(`The configured Circle agent wallet is ${agentWallet.blockchain}, but escrow requires ${ESCROW_BLOCKCHAIN}`);
    }
    const balance = await wallets.getWalletTokenBalance({
      id: config.agentWalletId,
      tokenAddresses: [ARC.contracts.usdc],
    });
    const amount = balance.data?.tokenBalances?.find((entry) => entry.token?.tokenAddress?.toLowerCase() === ARC.contracts.usdc.toLowerCase())?.amount || "0";
    if (Number(amount) <= 0) {
      throw new Error("The Circle escrow agent wallet has no Arc Testnet USDC. Fund the configured agent SCA from faucet.circle.com, then retry.");
    }
    const response = await contracts.deployContract({
      idempotencyKey: randomUUID(),
      // Smart Contract Platform only accepts alphanumeric contract names.
      name: `OffGridEscrow${name}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50) || "OffGridEscrow",
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
