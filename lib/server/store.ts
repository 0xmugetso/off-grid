import "server-only";

import { neon } from "@neondatabase/serverless";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StoredUser {
  id: string;
  walletAddress: string;
  username: string;
  displayName: string;
  sandboxFiatBalance: string;
  sandboxFiatPending: string;
  createdAt: string;
}

export interface StoredInvoice {
  id: string;
  senderId: string;
  recipientUserId: string | null;
  recipientAddress: string;
  recipientLabel: string;
  amount: string;
  token: "USDC";
  fundingMethod: "arc_wallet" | "unified_balance" | "cctp_bridge" | "fiat_bank";
  sourceChain?: string;
  protocol?: "send" | "gateway" | "cctp" | "fiat";
  bridgeSteps?: Array<{ name: string; txHash?: string; explorerUrl?: string }>;
  paymentSessionId?: string;
  txHash: string;
  explorerUrl: string;
  status: "confirmed";
  memo: string;
  createdAt: string;
}

export type CctpOperationStatus = "awaiting_signature" | "attesting" | "minting" | "confirmed" | "failed";

export type StoredFiatPayoutStatus = "submitted" | "pending" | "confirmed" | "failed";

export interface StoredFiatPayout {
  id: string;
  ownerId: string;
  paymentSessionId: string | null;
  circlePayoutId: string | null;
  bankAccountId: string;
  amount: string;
  currency: "USD";
  reference: string;
  status: StoredFiatPayoutStatus;
  trackingRef: string | null;
  destinationName: string | null;
  sourceWalletId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCctpOperation {
  id: string;
  ownerId: string;
  recipientUserId: string | null;
  recipientAddress: string;
  recipientLabel: string;
  amount: string;
  sourceChain: string;
  sourceDomain: number;
  status: CctpOperationStatus;
  burnTxHash: string | null;
  burnExplorerUrl: string | null;
  mintTxHash: string | null;
  mintExplorerUrl: string | null;
  bridgeSteps: Array<{ name: string; txHash?: string; explorerUrl?: string }>;
  memo: string;
  paymentSessionId: string | null;
  invoiceId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentRail = "web3_usdc" | "fiat_bank";
export type PayerInputRail = "web3_usdc" | "fiat_bank" | "card_moonpay" | "card_stripe" | "crypto_base" | "crypto_solana" | "crypto_arc";
export type ReceiverOutputRail = "web3_usdc" | "fiat_bank" | "fiat_bank_ach" | "fiat_bank_sepa" | "yield_usyc" | "crypto_wallet";
export type PayerRailStatus = "pending_selection" | "terms_locked" | "funding" | "funded_on_arc" | "failed";
export type ReceiverRailStatus = "pending_selection" | "terms_locked" | "destination_set" | "payout_dispatching" | "settled";
export type ClearingStatus = "created" | "awaiting_payer" | "awaiting_receiver" | "clearing_on_arc" | "settled";

export interface ReceiverBankDetails {
  accountHolderName: string;
  ibanOrAccountNumber: string;
  routingOrSwift: string;
  bankCountry: string;
}

export interface StoredPaymentSession {
  id: string;
  inviteTokenHash: string;
  creatorId: string;
  counterpartyId: string | null;
  creatorIntent: "pay" | "receive";
  creatorRail: PaymentRail;
  counterpartyRail: PaymentRail | null;
  payerInputRail: PayerInputRail | null;
  receiverOutputRail: ReceiverOutputRail | null;
  receiverBankDetails?: ReceiverBankDetails | null;
  payerRailStatus: PayerRailStatus;
  receiverRailStatus: ReceiverRailStatus;
  clearingStatus: ClearingStatus;
  arcEscrowTxHash: string | null;
  auditProof: Record<string, unknown> | null;
  amount: string;
  currency: "USD";
  memo: string;
  status: "open" | "ready" | "complete" | "cancelled" | "archived" | "expired";
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type EscrowStatus = "created" | "funded" | "submitted" | "validated" | "refunded";

export interface StoredEscrow {
  id: string;
  creatorId: string;
  title: string;
  category: "code" | "digital_goods" | "api_key" | "freelance";
  clientAddress: string;
  clientName: string;
  providerAddress: string;
  providerName: string;
  amount: string;
  specs: string;
  status: EscrowStatus;
  deliverableUrl?: string;
  deliverableProof?: string;
  aiVerificationLogs: string[];
  depositTxHash?: string;
  releaseTxHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  users: StoredUser[];
  invoices: StoredInvoice[];
  paymentSessions: StoredPaymentSession[];
  cctpOperations: StoredCctpOperation[];
  fiatPayouts: StoredFiatPayout[];
  escrows: StoredEscrow[];
}

const dataDirectory = path.join(process.cwd(), ".data");
const databasePath = path.join(dataDirectory, "offgrid.json");
let writeQueue = Promise.resolve();
let hostedStoreReady: Promise<void> | null = null;

function hostedDatabaseUrl() {
  return process.env.DATABASE_URL?.trim()
    || process.env.POSTGRES_URL?.trim()
    || process.env.POSTGRES_URL_NON_POOLING?.trim()
    || "";
}

export function persistenceMode() {
  return hostedDatabaseUrl() ? "postgres" as const : "local" as const;
}

function hostedSql() {
  const url = hostedDatabaseUrl();
  if (!url) {
    if (process.env.NODE_ENV === "production") throw new Error("A hosted Postgres connection is required in production. Set DATABASE_URL or POSTGRES_URL in Vercel.");
    throw new Error("Hosted Postgres is not configured");
  }
  return neon(url);
}

function emptyDatabase(): Database {
  return { users: [], invoices: [], paymentSessions: [], cctpOperations: [], fiatPayouts: [], escrows: [] };
}

function normalizeUser(user: Partial<StoredUser>): StoredUser {
  const walletAddress = typeof user.walletAddress === "string" ? user.walletAddress : "";
  return {
    id: String(user.id ?? randomUUID()),
    walletAddress,
    username: String(user.username ?? (walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "")),
    displayName: String(user.displayName ?? user.username ?? walletAddress),
    sandboxFiatBalance: typeof user.sandboxFiatBalance === "string" ? user.sandboxFiatBalance : "0",
    sandboxFiatPending: typeof user.sandboxFiatPending === "string" ? user.sandboxFiatPending : "0",
    createdAt: String(user.createdAt ?? new Date().toISOString()),
  };
}

function normalizeDatabase(value: unknown): Database {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  const parsed = (source && typeof source === "object" ? source : {}) as Partial<Database>;
  return {
    users: Array.isArray(parsed.users) ? parsed.users.map((user) => normalizeUser(user as Partial<StoredUser>)) : [],
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    paymentSessions: Array.isArray(parsed.paymentSessions) ? parsed.paymentSessions : [],
    cctpOperations: Array.isArray(parsed.cctpOperations) ? parsed.cctpOperations : [],
    fiatPayouts: Array.isArray(parsed.fiatPayouts) ? parsed.fiatPayouts : [],
    escrows: Array.isArray(parsed.escrows) ? parsed.escrows : [],
  };
}

async function ensureHostedStore() {
  if (!hostedStoreReady) {
    const sql = hostedSql();
    hostedStoreReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS offgrid_state (id integer PRIMARY KEY, revision bigint NOT NULL DEFAULT 0, data jsonb NOT NULL)`;
      await sql`INSERT INTO offgrid_state (id, revision, data) VALUES (1, 0, ${JSON.stringify(emptyDatabase())}::jsonb) ON CONFLICT (id) DO NOTHING`;
    })().catch((error) => {
      hostedStoreReady = null;
      throw error;
    });
  }
  await hostedStoreReady;
}

async function readDatabase(): Promise<Database> {
  try {
    const parsed = JSON.parse(await readFile(databasePath, "utf8")) as Partial<Database>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users.map((user) => normalizeUser(user as Partial<StoredUser>)) : [],
      invoices: parsed.invoices ?? [],
      paymentSessions: parsed.paymentSessions ?? [],
      cctpOperations: parsed.cctpOperations ?? [],
      fiatPayouts: parsed.fiatPayouts ?? [],
      escrows: parsed.escrows ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { users: [], invoices: [], paymentSessions: [], cctpOperations: [], fiatPayouts: [], escrows: [] };
  }
}

async function readHostedDatabase() {
  await ensureHostedStore();
  const rows = await hostedSql()`SELECT data FROM offgrid_state WHERE id = 1` as Array<{ data: unknown }>;
  return normalizeDatabase(rows[0]?.data);
}

async function writeDatabase(database: Database) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
  await rename(temporaryPath, databasePath);
}

export async function queryDatabase<T>(query: (database: Database) => T | Promise<T>) {
  if (hostedDatabaseUrl()) return query(await readHostedDatabase());
  return query(await readDatabase());
}

export async function mutateDatabase<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
  if (hostedDatabaseUrl()) {
    await ensureHostedStore();
    const sql = hostedSql();
    // Optimistic compare-and-swap keeps the existing store API while making
    // concurrent Vercel invocations safe without holding a WebSocket session.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = await sql`SELECT revision, data FROM offgrid_state WHERE id = 1` as Array<{ revision: string | number; data: unknown }>;
      const revision = String(rows[0]?.revision ?? "0");
      const database = normalizeDatabase(rows[0]?.data);
      const result = await mutation(database);
      const updated = await sql`UPDATE offgrid_state SET revision = revision + 1, data = ${JSON.stringify(database)}::jsonb WHERE id = 1 AND revision = ${revision} RETURNING revision`;
      if (updated.length) return result;
    }
    throw new Error("Database was busy; please retry the request");
  }
  let result!: T;
  const operation = writeQueue.then(async () => {
    const database = await readDatabase();
    result = await mutation(database);
    await writeDatabase(database);
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  await operation;
  return result;
}

export function publicUser(user: StoredUser) {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    username: user.username,
    displayName: user.displayName,
    sandboxFiatBalance: user.sandboxFiatBalance,
    sandboxFiatPending: user.sandboxFiatPending,
    createdAt: user.createdAt,
  };
}
