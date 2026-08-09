import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
if (!apiKey || !entitySecret) {
  throw new Error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET before creating the escrow agent wallet.");
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const walletSetResponse = await client.createWalletSet({
  idempotencyKey: randomUUID(),
  name: "OffGrid Arc Escrow Agent",
});
const walletSetId = walletSetResponse.data?.walletSet?.id;
if (!walletSetId) throw new Error("Circle did not return a wallet set ID.");

const walletResponse = await client.createWallets({
  idempotencyKey: randomUUID(),
  accountType: "SCA",
  blockchains: ["ARC-TESTNET"],
  count: 1,
  walletSetId,
});
const wallet = walletResponse.data?.wallets?.[0];
if (!wallet?.id || !wallet.address) throw new Error("Circle did not return the Arc agent wallet.");

console.log("Circle Arc escrow agent created. Add these server-only values to Vercel:");
console.log(`CIRCLE_ESCROW_AGENT_WALLET_ID=${wallet.id}`);
console.log(`CIRCLE_ESCROW_AGENT_ADDRESS=${wallet.address}`);
