import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function loadDotEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnvFile(".env.local");

const baseUrl = process.env.CIRCLE_MINT_BASE_URL || "https://api-sandbox.circle.com";
const apiKey = process.env.CIRCLE_MINT_API_KEY;
const idempotencyKey = process.env.CIRCLE_MINT_IDEMPOTENCY_KEY || randomUUID();

if (!apiKey) {
  console.error("Missing CIRCLE_MINT_API_KEY");
  process.exit(1);
}

const payload = {
  idempotencyKey,
  accountNumber: process.env.CIRCLE_MINT_WIRE_ACCOUNT_NUMBER || "1234567890",
  routingNumber: process.env.CIRCLE_MINT_WIRE_ROUTING_NUMBER || "021000021",
  billingDetails: {
    name: process.env.CIRCLE_MINT_WIRE_BILLING_NAME || "OffGrid Sandbox",
    line1: process.env.CIRCLE_MINT_WIRE_BILLING_LINE1 || "100 Money Street",
    line2: process.env.CIRCLE_MINT_WIRE_BILLING_LINE2 || "Suite 1",
    city: process.env.CIRCLE_MINT_WIRE_BILLING_CITY || "San Francisco",
    country: process.env.CIRCLE_MINT_WIRE_BILLING_COUNTRY || "US",
    district: process.env.CIRCLE_MINT_WIRE_BILLING_DISTRICT || "CA",
    postalCode: process.env.CIRCLE_MINT_WIRE_BILLING_POSTAL_CODE || "94105",
  },
  bankAddress: {
    bankName: process.env.CIRCLE_MINT_WIRE_BANK_NAME || "Sandbox National Bank",
    line1: process.env.CIRCLE_MINT_WIRE_BANK_LINE1 || "100 Money Street",
    line2: process.env.CIRCLE_MINT_WIRE_BANK_LINE2 || "Suite 1",
    city: process.env.CIRCLE_MINT_WIRE_BANK_CITY || "San Francisco",
    country: process.env.CIRCLE_MINT_WIRE_BANK_COUNTRY || "US",
    district: process.env.CIRCLE_MINT_WIRE_BANK_DISTRICT || "CA",
  },
};

const response = await fetch(`${baseUrl}/v1/businessAccount/banks/wires`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

const text = await response.text();

if (!response.ok) {
  console.error(`Circle Mint wire account creation failed with HTTP ${response.status}`);
  console.error(text);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.log(text);
  process.exit(0);
}

const bankAccount = data?.data ?? data;

console.log(JSON.stringify({
  idempotencyKey,
  bankAccountId: bankAccount?.id ?? bankAccount?.bankAccountId ?? null,
  wireInstructions: bankAccount?.wireInstructions ?? null,
  raw: data,
}, null, 2));
