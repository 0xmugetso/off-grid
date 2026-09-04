"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bell,
  Blocks,
  Bot,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck,
  FileCode,
  Fingerprint,
  Fuel,
  Globe2,
  Lock,
  LockKeyhole,
  LogOut,
  LayoutDashboard,
  Network,
  Plus,
  Radio,
  Receipt,
  RefreshCw,
  Scale,
  Search,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  User,
  UserRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createPublicClient, encodeFunctionData, http, isAddress, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { NeonMesh } from "@/components/ui/neon-mesh";
import { ArcPayrollClient, getArcMintStep, type BrowserSolanaAdapter, type BrowserViemAdapter, type CircleAdapter, type GatewayMintRetry } from "@/lib/arc/app-kit-client";
import { discoverBrowserWallets, ensureArcTestnet, ensureGatewaySourceChain, requestWalletAccount, type BrowserWallet } from "@/lib/arc/browser-wallet";
import { ARC, CCTP_SOURCE_CHAINS, CHAIN_LABELS, SOURCE_CHAINS, type CctpSourceChain, type EvmSourceChain, type SourceChain } from "@/lib/arc/config";
import { connectSolanaWallet as requestSolanaAccount, discoverSolanaWallets, getSolanaWalletProvider, reconnectSolanaWallet, type SolanaBrowserWallet } from "@/lib/arc/solana-wallet";
import type { PaymentRail, PaymentSessionView } from "@/lib/payment-session-types";
import { MassPaymentView, type MassFunding, type MassRunResult, type MassTeamMember } from "@/components/mass-payment-view";
import { ChainLogo, ChainName, ChainSelect } from "@/components/chain-logo";
import { FiatOnRampModal } from "@/components/fiat-onramp-modal";
import { isSubmittedCctpOperation } from "@/lib/cctp-operations";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReceiptCodeRain } from "@/components/receipt-code-rain";
import { downloadReceiptPng } from "@/lib/download-receipt";
import { gatewayExplorerUrl } from "@/lib/gateway-explorer";
import { OffGridLoader as LoaderCircle } from "@/components/ui/offgrid-loader";

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  walletAddress: string | null;
  sandboxFiatBalance: string;
  sandboxFiatPending: string;
  createdAt: string;
}

interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  walletAddress: string;
}

interface InvoiceData {
  id: string;
  senderId: string;
  recipientUserId: string | null;
  recipientAddress: string;
  recipientLabel: string;
  amount: string;
  token: "USDC";
  fundingMethod: FundingMethod;
  sourceChain?: string;
  protocol?: "send" | "gateway" | "cctp" | "fiat";
  paymentSessionId?: string | null;
  bridgeSteps?: Array<{ name: string; txHash?: string; explorerUrl?: string }>;
  txHash: string;
  explorerUrl: string;
  status: "confirmed";
  memo: string;
  createdAt: string;
}

type PayStep = "recipient" | "amount" | "review" | "processing" | "complete";
type WorkspaceView = "transfer" | "history" | "unified" | "mass" | "escrow" | "agents";
type FundingMethod = "arc_wallet" | "unified_balance" | "cctp_bridge" | "fiat_bank";
type PaymentEstimate = { title: string; detail: string; fees: string };
type PaymentIssue = { title: string; detail: string; retryable: boolean };
type ProtocolEvent = { name: string; state: string; explorerUrl?: string };
type ChainAwareProvider = BrowserWallet["provider"] & {
  on?: (event: "chainChanged", listener: (chainId: string) => void) => void;
  removeListener?: (event: "chainChanged", listener: (chainId: string) => void) => void;
};
type GatewayDeposit = {
  id: string;
  status: "submitted" | "source_confirmed" | "indexing" | "confirmed" | "failed";
  amount: string;
  sourceChain: string;
  sourceAddress: string;
  txHash: string;
  explorerUrl: string | null;
  observedGatewayBalance: string | null;
  confirmedBefore: string | null;
  expectedConfirmed: string | null;
  sourceBlockNumber: string | null;
  sourceConfirmedAt: string | null;
  gatewayPendingObserved: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
type GatewayChainBalance = {
  chain: SourceChain;
  confirmed: string;
  pending: string;
  queried: boolean;
};
type CctpOperation = {
  id: string;
  recipientAddress: string;
  recipientLabel: string;
  amount: string;
  sourceChain: CctpSourceChain;
  status: "awaiting_signature" | "attesting" | "minting" | "confirmed" | "failed";
  burnTxHash: string | null;
  burnExplorerUrl: string | null;
  mintTxHash: string | null;
  mintExplorerUrl: string | null;
  invoiceId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
type FiatPayout = {
  id: string;
  ownerId: string;
  paymentSessionId: string | null;
  circlePayoutId: string | null;
  bankAccountId: string;
  amount: string;
  currency: "USD";
  reference: string;
  status: "submitted" | "pending" | "confirmed" | "failed";
  trackingRef: string | null;
  destinationName: string | null;
  sourceWalletId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
type CctpActionEvent = { method: string; traceId?: string; state: string; txHash?: string; explorerUrl?: string };

function getCctpActionEvent(payload: unknown): CctpActionEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.protocol !== "cctp" || root.version !== "v2" || typeof root.method !== "string") return null;
  const values = root.values && typeof root.values === "object" ? root.values as Record<string, unknown> : {};
  return {
    method: root.method,
    traceId: typeof root.traceId === "string" ? root.traceId : undefined,
    state: typeof values.state === "string" ? values.state : "pending",
    txHash: typeof values.txHash === "string" ? values.txHash : undefined,
    explorerUrl: typeof values.explorerUrl === "string" ? values.explorerUrl : undefined,
  };
}

function buildGatewayChainBalances(result: { breakdown: Array<{ breakdown: Array<{ chain: string; confirmedBalance: string; pendingBalance?: string }> }> }, solanaConnected: boolean): GatewayChainBalance[] {
  const totals = new Map<SourceChain, { confirmed: number; pending: number }>();
  for (const account of result.breakdown) {
    for (const row of account.breakdown) {
      if (!SOURCE_CHAINS.includes(row.chain as SourceChain)) continue;
      const chain = row.chain as SourceChain;
      const current = totals.get(chain) ?? { confirmed: 0, pending: 0 };
      totals.set(chain, { confirmed: current.confirmed + Number(row.confirmedBalance), pending: current.pending + Number(row.pendingBalance ?? 0) });
    }
  }
  return SOURCE_CHAINS.map((chain) => ({
    chain,
    confirmed: String(totals.get(chain)?.confirmed ?? 0),
    pending: String(totals.get(chain)?.pending ?? 0),
    queried: chain !== "Solana_Devnet" || solanaConnected,
  }));
}

function describeSolanaReadIssue(message: string) {
  if (/failed to fetch|fetch failed|failed to get info|timed? out|429|rate.?limit/i.test(message)) {
    return "Connected, but Solana Devnet is not answering balance requests. Your wallet is still connected; retry shortly.";
  }
  return "Solana connected, but its Devnet USDC balance could not be read. Retry the balance without reconnecting.";
}

function fundingLabel(method: FundingMethod) {
  if (method === "cctp_bridge") return "CCTP V2";
  if (method === "unified_balance") return "GATEWAY";
  if (method === "fiat_bank") return "SANDBOX FIAT";
  return "DIRECT WALLET";
}

function cctpStatusDetail(operation: CctpOperation) {
  if (operation.errorMessage && /took too long|timed? out/i.test(operation.errorMessage)) return "Source RPC timed out before wallet submission";
  if (operation.errorMessage) return operation.errorMessage.split("\n")[0];
  if (operation.status === "attesting") return "Waiting for Circle attestation";
  if (operation.status === "minting") return "Attested; waiting for destination mint confirmation";
  return "CCTP transfer needs attention";
}

function normalizeProtocolEvent(payload: unknown): ProtocolEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const values = root.values && typeof root.values === "object" ? root.values as Record<string, unknown> : root;
  const name = typeof values.name === "string" ? values.name : typeof root.method === "string" ? root.method : "";
  const state = typeof values.state === "string" ? values.state : "pending";
  if (!name) return null;
  const explorerUrl = typeof values.explorerUrl === "string" ? values.explorerUrl : undefined;
  return { name, state, explorerUrl };
}

function sessionEventSnapshot(session: PaymentSessionView) {
  return [session.status, session.nextAction, session.invoiceId ?? ""].join(":");
}

function readShownSessionEvents() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = JSON.parse(window.sessionStorage.getItem("offgrid-shown-session-events") || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function persistShownSessionEvents(events: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("offgrid-shown-session-events", JSON.stringify(Array.from(events).slice(-120)));
  } catch {
    // Notification deduplication is best effort only.
  }
}

function fiatProofEvents(session: PaymentSessionView): ProtocolEvent[] {
  const settlement = session.fiatSettlement;
  if (!settlement) return [{ name: "Preparing provider proof route", state: "pending" }];
  return [
    { name: settlement.mockWireTrackingRef ? `Sandbox wire accepted · ${settlement.mockWireTrackingRef}` : "Submitting sandbox wire", state: settlement.mockWireTrackingRef ? "confirmed" : "pending" },
    { name: settlement.circleDepositId ? `Circle deposit verified · ${settlement.circleDepositId}` : "Waiting for Circle deposit", state: settlement.circleDepositStatus && /fail|denied|cancel/i.test(settlement.circleDepositStatus) ? "failed" : settlement.circleDepositId ? "confirmed" : "pending" },
    { name: settlement.receiverTransferId ? `Wallet payout submitted · ${settlement.receiverTransferId}` : "Preparing testnet USDC delivery", state: settlement.receiverTransferId ? (settlement.receiverTxHash ? "confirmed" : "pending") : "pending" },
    { name: settlement.receiverTxHash ? `USDC verified onchain · ${shortAddress(settlement.receiverTxHash, 8)}` : "Waiting for onchain receipt", state: settlement.arcBlockNumber ? "confirmed" : "pending", explorerUrl: settlement.receiverTxHash ? `https://testnet.arcscan.app/tx/${settlement.receiverTxHash}` : undefined },
  ];
}

function bridgeFeeSummary(estimate: { fees?: Array<{ amount?: string | null; token?: string }> }) {
  const fees = estimate.fees?.filter((fee) => fee.amount && Number(fee.amount) > 0) ?? [];
  if (!fees.length) return "No CCTP protocol fee on standard transfer";
  return fees.map((fee) => `${fee.amount} ${fee.token ?? "USDC"}`).join(" + ");
}

function compactPaymentError(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function describeGatewayDepositIssue(message: string, chain: SourceChain) {
  const source = CHAIN_LABELS[chain];
  if (/user rejected|user denied|rejected the request|request rejected/i.test(message)) return "Deposit cancelled in your wallet. No Gateway transaction was submitted.";
  if (/chain is not available on free plan|sepolia\.drpc\.org/i.test(message)) return `Your wallet is still using its retired ${source} RPC. No transaction was submitted. In Rabby, open Settings, Networks, Modify RPC URL, select ${source}, and use https://rpc.sepolia.org. You can also retry with MetaMask.`;
  if (/rpc request failed|failed to fetch|network request failed|timeout|timed out/i.test(message)) return `${source} could not complete the network check. No transaction was submitted. Retry when the source network responds.`;
  if (/insufficient funds|insufficient balance/i.test(message)) return `Your ${source} wallet needs enough USDC and native gas for this deposit.`;
  if (/chain.*mismatch|unknown blockchain|unsupported chain/i.test(message)) return `Switch your wallet to ${source}, then review the Gateway deposit again.`;
  return compactPaymentError(message) || "The Gateway deposit could not be submitted.";
}

function getGatewayMintRetry(error: unknown): GatewayMintRetry | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { recoverability?: unknown; cause?: { trace?: unknown } };
  if (candidate.recoverability !== "RESUMABLE" || !candidate.cause?.trace || typeof candidate.cause.trace !== "object") return null;
  const trace = candidate.cause.trace as { attestation?: unknown; signature?: unknown };
  return typeof trace.attestation === "string" && trace.attestation.length > 0 && typeof trace.signature === "string" && trace.signature.length > 0
    ? { attestation: trace.attestation, signature: trace.signature }
    : null;
}

function describePaymentIssue(message: string, sourceChain: CctpSourceChain, fundingMethod: FundingMethod = "cctp_bridge"): PaymentIssue {
  if (fundingMethod === "unified_balance") {
    if (/source transfer|funds locked|mint failure|attestation|config\.retry|network connection failed for arc/i.test(message)) {
      return { title: "Destination mint needs recovery", detail: "Gateway accepted the source transfer, but the destination mint was not confirmed. The source transfer will not be submitted again; retry the saved mint when the Arc Testnet RPC responds.", retryable: true };
    }
    if (/insufficient funds|insufficient balance|exceeds balance|balance_insufficient|insufficient_token/i.test(message)) {
      return { title: "Not enough confirmed Gateway balance", detail: "Gateway needs the payment amount plus its source-chain fee. Deposit more USDC or reduce the amount, then check the route again.", retryable: true };
    }
    if (/request took too long|timed? out|timeout|fetch failed|failed to fetch|http request failed|rate.?limit|429|503|gateway timeout|read contract failed/i.test(message)) {
      return { title: "Circle Gateway is responding slowly", detail: "No transaction was submitted. A source-chain RPC or Gateway preflight request timed out; retry once the network responds.", retryable: true };
    }
    if (/unsupported|not supported|invalid.*chain|chain.*support/i.test(message)) {
      return { title: "Gateway route is not supported", detail: "The selected source or Arc Testnet destination is not available for this Gateway route. Refresh balances and retry with a supported testnet source.", retryable: true };
    }
    return { title: "Gateway route check failed", detail: `No transaction was submitted. ${compactPaymentError(message) || "Circle could not validate this spend."} Retry after confirming your connected wallet and confirmed Gateway balance.`, retryable: true };
  }
  const source = CHAIN_LABELS[sourceChain];
  if (/request took too long|timed? out|timeout|fetch failed|failed to fetch|http request failed|rate.?limit|429|503|gateway timeout|read contract failed/i.test(message)) {
    return {
      title: `${source} is responding slowly`,
      detail: `The RPC timed out while App Kit checked your source-chain USDC. Nothing was signed or sent. OffGrid will try another endpoint when you retry.`,
      retryable: true,
    };
  }
  if (/user rejected|user denied|rejected the request|request rejected/i.test(message)) {
    return { title: "Wallet confirmation was cancelled", detail: "No transaction was submitted. You can review the route and try again whenever you are ready.", retryable: true };
  }
  if (/insufficient funds|insufficient balance|exceeds balance/i.test(message)) {
    return { title: "Not enough funds on the source chain", detail: `Add USDC and enough native gas on ${source}, then retry the live route check.`, retryable: true };
  }
  if (/connect the selected source wallet/i.test(message)) {
    return { title: "Source wallet required", detail: `Connect the wallet that holds your ${source} USDC before checking this route.`, retryable: false };
  }
  return {
    title: "The live route could not be verified",
    detail: "No transaction was submitted. Check the selected source network and wallet balance, then retry the route check.",
    retryable: true,
  };
}

function Logo() {
  return <span className="og-logo"><i /><i /><i /></span>;
}

function UsdcMark({ size = 28 }: { size?: number }) {
  return <span className="usdc-mark" style={{ width: size, height: size }} aria-label="USDC">
    <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2775ca"/>
      <path fill="#fff" d="M17.75 24.12v2.3h-3.16v-2.24c-3.2-.46-5.08-2.3-5.08-4.91h3.02c0 1.45 1.12 2.35 3.36 2.35 2.08 0 3.12-.75 3.12-1.85 0-.96-.66-1.51-2.35-1.87l-2.35-.5c-2.91-.62-4.38-2.15-4.38-4.55 0-2.51 1.74-4.31 4.66-4.83V5.58h3.16v2.39c2.81.5 4.5 2.28 4.5 4.72h-3.02c0-1.31-1.04-2.16-2.91-2.16-1.91 0-2.95.73-2.95 1.89 0 .94.71 1.52 2.22 1.84l2.33.49c3.12.66 4.55 2.1 4.55 4.52 0 2.57-1.7 4.32-4.73 4.85Z"/>
      <path fill="#fff" d="M8.06 25.17a12.1 12.1 0 0 1 0-18.34l1.68 1.87a9.58 9.58 0 0 0 0 14.6l-1.68 1.87Zm15.88 0-1.68-1.87a9.58 9.58 0 0 0 0-14.6l1.68-1.87a12.1 12.1 0 0 1 0 18.34Z"/>
    </svg>
  </span>;
}

function shortAddress(address: string, size = 5) {
  return `${address.slice(0, size + 2)}…${address.slice(-4)}`;
}

function displayMoney(value: string | number, digits = 2) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const USERNAME_ADJECTIVES = ["bouncy", "brave", "cosmic", "dizzy", "fuzzy", "jolly", "lucky", "mighty", "neon", "pixel", "quirky", "speedy", "tiny", "witty"];
const USERNAME_NOUNS = ["badger", "bean", "capybara", "dumpling", "gecko", "mango", "otter", "panda", "pickle", "raccoon", "rocket", "toaster", "walrus", "wizard"];

function generateFunnyUsername(current = "") {
  let candidate = current;
  while (candidate === current) {
    const adjective = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
    const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
    candidate = `${adjective}-${noun}`;
  }
  return candidate;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({} as { error?: string }))
    : { error: response.ok
      ? "The server returned an unexpected response. Please retry."
      : `Server returned ${response.status} ${response.statusText || "an error page"}. Check the deployment logs.` };
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [tab, setTab] = useState<"signin" | "register">("register");
  const [username, setUsername] = useState("neon-otter");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("offgrid-account-created") === "1") setTab("signin");
      else setUsername(generateFunnyUsername());
    } catch {
      // Private browsing may disable storage. Registration remains the safe default.
      setUsername(generateFunnyUsername());
    }
  }, []);

  async function handleWalletSignIn() {
    setBusy(true);
    setError("");
    try {
      const discovered = await discoverBrowserWallets();
      if (!discovered.length) throw new Error("No Web3 wallet detected. Please install MetaMask, Rabby, or Coinbase Wallet.");
      const wallet = discovered[0];
      const address = await requestWalletAccount(wallet.provider);

      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");

      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = "Sign in to OffGrid Payment Command Center.";
      const issuedAt = new Date().toISOString();
      const message = `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${origin}\nVersion: 1\nChain ID: ${ARC.chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

      const hexMessage = `0x${Buffer.from(message, "utf8").toString("hex")}`;
      const signature = (await wallet.provider.request({
        method: "personal_sign",
        params: [hexMessage, address] as unknown as [`0x${string}`, `0x${string}`],
      })) as string;

      const { user } = await api<{ user: User }>("/api/auth/siwe", {
        method: "POST",
        body: JSON.stringify({
          address,
          message,
          signature,
          mode: tab,
          username: tab === "register" ? username : undefined,
          displayName: tab === "register" ? displayName : undefined,
        }),
      });

      try { window.localStorage.setItem("offgrid-account-created", "1"); } catch { /* private mode */ }
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-atmosphere">
        <div className="auth-grid" />
        <div className="auth-center">
          <div className="auth-logo-stage"><Logo /></div>
          <b>offgrid</b>
          <small>GLOBAL PAYMENT PROTOCOL</small>
        </div>
        <div className="auth-copy">
          <span className="signal-pill"><Radio size={12} /> ONE PAYMENT NETWORK</span>
          <h1>Money without<br /><em>borders.</em></h1>
          <p>Pay with bank rails or multichain USDC. Settle to wallets, local accounts, or one unified balance with verifiable proof.</p>
          <div className="auth-proof"><span><Zap size={15} /> Any-to-any payments</span><span><ShieldCheck size={15} /> Verifiable settlement</span><span><Network size={15} /> Self-custodial access</span></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <div className="auth-form-head">
            <span><Fingerprint size={16} /> {tab === "signin" ? "SECURE WALLET SIGN-IN" : "CREATE OFFGRID ACCOUNT"}</span>
            <h2>{tab === "signin" ? "Welcome back" : "Create your OffGrid ID"}</h2>
            <p>{tab === "signin" ? "Open your balances, payment sessions, and verified transaction history." : "Create one identity for payments, payroll, escrow, and cross-chain settlement."}</p>
          </div>
          {tab === "register" && (
            <div className="auth-row">
              <label>Display name (optional)
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Morgan" />
              </label>
              <label>Username
                <div className="prefix-input username-generator-field">
                  <span>@</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24))} placeholder="funny-otter" />
                  <button type="button" onClick={() => setUsername((current) => generateFunnyUsername(current))} aria-label="Generate another username" title="Generate another username"><RefreshCw size={13}/></button>
                </div>
              </label>
            </div>
          )}
          {error && <p className="form-error"><CircleAlert size={14} /> {error}</p>}
          <button className="neon-button" onClick={handleWalletSignIn} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Fingerprint size={17} />}
            {tab === "signin" ? "Sign in with Wallet" : "Register & Sign in with Wallet"}
            <ArrowRight size={16} />
          </button>
          <p className="auth-switch">
            {tab === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button type="button" onClick={() => { const next = tab === "signin" ? "register" : "signin"; setTab(next); if (next === "register" && !username) setUsername(generateFunnyUsername()); setError(""); }}>
              {tab === "signin" ? "Register here" : "Sign in here"}
            </button>
          </p>
        </div>
        <p className="auth-security"><LockKeyhole size={13} /> Your wallet signs in. OffGrid never stores passwords or private keys.</p>
      </section>
    </main>
  );
}

function Invoice({ invoice, user, onClose }: { invoice: InvoiceData; user: User; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [closing, setClosing] = useState(false);
  const receiptRef = useRef<HTMLElement>(null);
  const shareUrl = `${window.location.origin}/invoice/${invoice.id}`;

  async function share() {
    const shareData = { title: `OffGrid receipt - ${invoice.amount} USDC`, text: `${user.displayName} paid ${invoice.recipientLabel} on Arc Testnet.`, url: shareUrl };
    if (navigator.share) await navigator.share(shareData);
    else { await navigator.clipboard.writeText(shareUrl); setCopied(true); }
  }

  async function download() {
    if (!receiptRef.current || downloading) return;
    setDownloading(true);
    try { await downloadReceiptPng(receiptRef.current, { reference: invoice.id, amount: invoice.amount, createdAt: invoice.createdAt }); }
    finally { setDownloading(false); }
  }

  function close() {
    setClosing(true);
    window.setTimeout(onClose, 220);
  }

  return (
    <div className={`overlay receipt-overlay ${closing ? "is-closing" : ""}`}>
      <ReceiptCodeRain modal />
      <article className="invoice-modal" ref={receiptRef}>
        <button className="modal-x" data-receipt-ignore="true" onClick={close}><X size={18} /></button>
        <div className="invoice-beam"><i /><span><Check size={30} /></span><i /></div>
        <span className="invoice-status"><Radio size={11} /> PAYMENT CONFIRMED</span>
        <h2>Payment complete.</h2>
        <p>The network confirmed your transfer. This receipt is backed by the transaction below.</p>
        <div className="invoice-amount"><small>AMOUNT SETTLED</small><b>{displayMoney(invoice.amount)} <em>USDC</em></b><span>≈ ${displayMoney(invoice.amount)} USD</span></div>
        <div className="invoice-route">
          <span><small>FROM</small><b>{user.displayName}</b><em>{shortAddress(user.walletAddress ?? "")}</em></span>
          <div><i /><Zap size={14} /><i /></div>
          <span><small>TO</small><b>{invoice.recipientLabel}</b><em>{shortAddress(invoice.recipientAddress)}</em></span>
        </div>
        {invoice.memo && <div className="invoice-memo"><small>MEMO</small><p>{invoice.memo}</p></div>}
        <dl className="invoice-meta"><div><dt>Network</dt><dd><ChainName chain="Arc_Testnet" size={15}/></dd></div><div><dt>Funding</dt><dd>{fundingLabel(invoice.fundingMethod)}</dd></div>{invoice.sourceChain && <div><dt>Source</dt><dd>{SOURCE_CHAINS.includes(invoice.sourceChain as SourceChain) ? <ChainName chain={invoice.sourceChain as SourceChain} size={15}/> : invoice.sourceChain}</dd></div>}<div><dt>Reference</dt><dd>{invoice.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Transaction</dt><dd><a href={invoice.explorerUrl} target="_blank" rel="noreferrer">{shortAddress(invoice.txHash, 7)} <ExternalLink size={11} /></a></dd></div></dl>
        {invoice.bridgeSteps && invoice.bridgeSteps.length > 0 && <div className="invoice-proof"><small>CCTP PROOF TRAIL</small>{invoice.bridgeSteps.filter((item) => item.explorerUrl).map((item) => <a href={item.explorerUrl} target="_blank" rel="noreferrer" key={`${item.name}-${item.txHash}`}>{item.name}<ExternalLink size={10} /></a>)}</div>}
        <div className="invoice-actions" data-receipt-ignore="true"><button className="neon-button" onClick={share}><Share2 size={16} /> {copied ? "Link Copied" : "Share Receipt"}</button><button onClick={() => void download()} disabled={downloading}>{downloading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} {downloading ? "Creating Image" : "Download Receipt"}</button></div>
        <small className="invoice-foot"><ShieldCheck size={12} /> Cryptographically verifiable on ArcScan</small>
      </article>
    </div>
  );
}

type LedgerEntry = {
  id: string;
  activity: string;
  detail: string;
  kind: "transfer" | "gateway" | "cctp" | "deposit" | "fiat";
  rail: string;
  amount: string;
  txHash: string;
  explorerUrl: string;
  receiptUrl?: string;
  status: "confirmed" | "pending" | "submitted" | "failed";
  createdAt: string;
  logs: Array<{ name: string; txHash?: string; explorerUrl?: string }>;
  meta?: {
    circlePayoutId?: string | null;
    bankAccountId?: string | null;
    sourceWalletId?: string | null;
    trackingRef?: string | null;
    circleDepositId?: string | null;
    circleDepositStatus?: string | null;
    circleDepositAmount?: string | null;
    receiverTransferId?: string | null;
    arcBlockNumber?: string | null;
    fiatMode?: "fiat_to_web3" | "web3_to_fiat" | "fiat_to_fiat";
    payerTransferTxHash?: string | null;
    circleInboundTransferId?: string | null;
    circleInboundTransferStatus?: string | null;
  };
};

function proofSteps(entry: LedgerEntry): Array<{ label: string; detail: string; tone: "muted" | "good" | "warning"; txHash?: string; explorerUrl?: string }> {
  const statusLabel = entry.status === "confirmed" ? "Confirmed" : entry.status === "failed" ? "Failed" : entry.status === "submitted" ? "Submitted" : "Pending";
  const sandboxTransfer = entry.meta?.fiatMode === "fiat_to_web3" || /sandbox fiat transfer/i.test(entry.activity) || /sandbox fiat balance/i.test(entry.rail);
  if (entry.kind === "fiat") {
    return sandboxTransfer
      ? [
          { label: "Mock wire", detail: entry.meta?.trackingRef ? `Circle tracking reference ${entry.meta.trackingRef}` : "Circle sandbox wire reference unavailable", tone: entry.meta?.trackingRef ? "good" as const : "warning" as const },
          { label: "Circle deposit", detail: entry.meta?.circleDepositId ? `${entry.meta.circleDepositId} · ${entry.meta.circleDepositStatus ?? "unknown"}${entry.meta.circleDepositAmount ? ` · ${entry.meta.circleDepositAmount} USD` : ""}` : "Circle deposit proof unavailable", txHash: entry.meta?.circleDepositId ?? undefined, tone: entry.meta?.circleDepositId ? "good" as const : "warning" as const },
          { label: "Wallet payout", detail: entry.meta?.receiverTransferId ?? "Developer wallet transaction ID unavailable", txHash: entry.meta?.receiverTransferId ?? undefined, tone: entry.meta?.receiverTransferId ? "good" as const : "warning" as const },
          { label: "Onchain receipt", detail: `${statusLabel}${entry.meta?.arcBlockNumber ? ` · Arc block ${entry.meta.arcBlockNumber}` : ""}`, txHash: entry.txHash, explorerUrl: entry.explorerUrl, tone: "good" as const },
        ]
      : [
          { label: "Payer deposit", detail: entry.meta?.payerTransferTxHash ? "The exact Arc Testnet USDC transfer was verified." : "Verified payer deposit unavailable", txHash: entry.meta?.payerTransferTxHash ?? undefined, explorerUrl: entry.meta?.payerTransferTxHash ? `https://testnet.arcscan.app/tx/${entry.meta.payerTransferTxHash}` : undefined, tone: entry.meta?.payerTransferTxHash ? "good" as const : "warning" as const },
          { label: "Circle inbound", detail: entry.meta?.circleInboundTransferId ? `${entry.meta.circleInboundTransferId} · ${entry.meta.circleInboundTransferStatus ?? "unknown"}` : "Circle inbound transfer proof unavailable", txHash: entry.meta?.circleInboundTransferId ?? undefined, tone: entry.meta?.circleInboundTransferId ? "good" as const : "warning" as const },
          { label: "Circle payout ID", detail: entry.meta?.circlePayoutId ?? entry.txHash, txHash: (entry.meta?.circlePayoutId ?? entry.txHash) || undefined, explorerUrl: entry.explorerUrl || undefined, tone: "good" as const },
          { label: "Bank route", detail: `${entry.meta?.bankAccountId ?? "Linked Circle Mint bank account"} · ${statusLabel}${entry.meta?.trackingRef ? ` · tracking ${entry.meta.trackingRef}` : ""}`, tone: entry.status === "failed" ? "warning" as const : "good" as const },
        ];
  }
  if (entry.kind === "cctp") {
    const burnLog = entry.logs.find((log) => /burn/i.test(log.name));
    const mintLog = entry.logs.find((log) => /mint|attest/i.test(log.name));
    return [
      { label: "Intent", detail: "CCTP was selected to move source-chain USDC to Arc Testnet.", tone: "muted" as const },
      { label: "Source burn", detail: burnLog?.txHash ? "Circle can trace the source burn transaction." : "Waiting for the source burn to appear.", txHash: burnLog?.txHash, explorerUrl: burnLog?.explorerUrl, tone: burnLog?.txHash ? "good" as const : "warning" as const },
      { label: "Destination mint", detail: mintLog?.txHash ? "The Arc Testnet mint was recorded in the settlement trail." : "Mint not yet recorded in the trail.", txHash: mintLog?.txHash, explorerUrl: mintLog?.explorerUrl, tone: mintLog?.txHash ? "good" as const : "warning" as const },
      { label: "Receipt", detail: entry.receiptUrl ? "A verified invoice exists for this transfer." : statusLabel, tone: entry.receiptUrl ? "good" as const : "muted" as const },
    ];
  }
  if (entry.kind === "deposit") {
    return [
      { label: "Intent", detail: "USDC was deposited into Circle Gateway to update the unified balance.", tone: "muted" as const },
      { label: "Source transaction", detail: entry.txHash, txHash: entry.txHash, explorerUrl: entry.explorerUrl, tone: "good" as const },
      { label: "Gateway indexing", detail: entry.status === "confirmed" ? "Gateway confirmed the deposit and updated the spendable balance." : "Gateway is still indexing this deposit.", tone: entry.status === "confirmed" ? "good" as const : "warning" as const },
    ];
  }
  return [
    { label: "Intent", detail: "A direct wallet transfer or Gateway spend was executed.", tone: "muted" as const },
    { label: "Transaction hash", detail: entry.txHash, txHash: entry.txHash, explorerUrl: entry.explorerUrl, tone: "good" as const },
    { label: "Receipt", detail: entry.receiptUrl ? "A matching OffGrid receipt is available." : statusLabel, tone: entry.receiptUrl ? "good" as const : "muted" as const },
  ];
}

type GatewayDepositPresentation = {
  label: string;
  detail: string;
  delayed: boolean;
  elapsed: string;
};

function formatGatewayElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m elapsed`;
}

function gatewayDepositPresentation(deposit: GatewayDeposit): GatewayDepositPresentation {
  const startedAt = Date.parse(deposit.sourceConfirmedAt || deposit.createdAt);
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
  const elapsed = formatGatewayElapsed(elapsedMs);

  if (deposit.status === "confirmed") return {
    label: "Balance Credited",
    detail: "Circle Gateway indexed this deposit and added it to the spendable unified balance.",
    delayed: false,
    elapsed,
  };
  if (deposit.status === "failed") return {
    label: "Deposit Failed",
    detail: deposit.errorMessage || "The source-chain deposit failed.",
    delayed: false,
    elapsed,
  };
  if (deposit.status === "submitted") return {
    label: "Source Confirmation",
    detail: "The wallet submitted the deposit. OffGrid is waiting for its source-chain receipt before tracking Circle.",
    delayed: false,
    elapsed,
  };

  const timing = deposit.sourceChain === "Arc_Testnet"
    ? { expected: "about 0.5 seconds", delayedAfterMs: 15_000 }
    : deposit.sourceChain === "Solana_Devnet"
      ? { expected: "about 8 seconds", delayedAfterMs: 30_000 }
      : { expected: "about 13 to 19 minutes", delayedAfterMs: 20 * 60_000 };
  const delayed = elapsedMs > timing.delayedAfterMs;

  if (delayed) return {
    label: "Circle Indexing Delayed",
    detail: `The deposit is final onchain. Circle's testnet Gateway has not credited it after ${elapsed.replace(" elapsed", "")}. Normal finality for this chain is ${timing.expected}. No second deposit is needed.`,
    delayed: true,
    elapsed,
  };
  if (deposit.status === "indexing" || deposit.gatewayPendingObserved) return {
    label: "Circle Indexing",
    detail: `Circle detected the deposit and is waiting for finality. This chain normally reaches Gateway credit in ${timing.expected}.`,
    delayed: false,
    elapsed,
  };
  return {
    label: "Source Confirmed",
    detail: `The Gateway contract accepted the deposit onchain. Circle is waiting for finality and ledger indexing, normally ${timing.expected}.`,
    delayed: false,
    elapsed,
  };
}

function gatewayDepositDetail(deposit: GatewayDeposit) {
  return gatewayDepositPresentation(deposit).detail;
}

function gatewayDepositLedgerEntry(deposit: GatewayDeposit): LedgerEntry {
  const explorerUrl = gatewayExplorerUrl(deposit.sourceChain as SourceChain, deposit.txHash);
  return {
    id: `deposit-${deposit.id}`,
    activity: "Fund Unified Balance",
    detail: gatewayDepositDetail(deposit),
    kind: "deposit",
    rail: `${CHAIN_LABELS[deposit.sourceChain as SourceChain] ?? deposit.sourceChain} → Gateway`,
    amount: deposit.amount,
    txHash: deposit.txHash,
    explorerUrl,
    status: deposit.status === "source_confirmed" || deposit.status === "indexing" || deposit.status === "submitted" ? "pending" : deposit.status,
    createdAt: deposit.createdAt,
    logs: [
      { name: "Gateway Source Transaction", txHash: deposit.txHash, explorerUrl },
      { name: deposit.status === "confirmed" ? "Circle Gateway Balance Credited" : gatewayDepositPresentation(deposit).label },
    ],
  };
}

function historyLabelForViewer(value: string, viewer: User, walletAddress: string) {
  const identities = [
    viewer.displayName,
    `@${viewer.username}`,
    viewer.username,
    viewer.walletAddress ?? "",
    walletAddress,
    viewer.walletAddress ? shortAddress(viewer.walletAddress) : "",
    shortAddress(walletAddress),
  ].filter((identity, index, all) => identity.length > 1 && all.indexOf(identity) === index).sort((a, b) => b.length - a.length);

  return identities.reduce((label, identity) => label.replaceAll(identity, "You"), value);
}

function HistoryView({ invoices, paymentSessions, deposits, walletAddress, viewer, cctpOperations, fiatPayouts, recovering, recoveryNote, onRecover, onRefreshCctp, onRefreshGateway, onRefreshFiat, onSelectEntry }: { invoices: InvoiceData[]; paymentSessions: PaymentSessionView[]; deposits: GatewayDeposit[]; walletAddress: string; viewer: User; cctpOperations: CctpOperation[]; fiatPayouts: FiatPayout[]; recovering: boolean; recoveryNote: string; onRecover: () => void; onRefreshCctp: () => void; onRefreshGateway: () => void; onRefreshFiat: () => void; onSelectEntry: (entry: LedgerEntry) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | LedgerEntry["kind"]>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "amount_high" | "amount_low">("newest");
  const [copiedHash, setCopiedHash] = useState("");
  const [recoveryChain, setRecoveryChain] = useState<CctpSourceChain>("Base_Sepolia");
  const [recoveryHash, setRecoveryHash] = useState("");
  const [manualRecoveryBusy, setManualRecoveryBusy] = useState(false);
  const [manualRecoveryNote, setManualRecoveryNote] = useState("");
  const [gatewayRecoveryOpen, setGatewayRecoveryOpen] = useState(false);
  const [gatewayRecoveryChain, setGatewayRecoveryChain] = useState<SourceChain>("Base_Sepolia");
  const [gatewayRecoveryHash, setGatewayRecoveryHash] = useState("");
  const [gatewayRecoveryAmount, setGatewayRecoveryAmount] = useState("");
  const [gatewayRecoveryBusy, setGatewayRecoveryBusy] = useState(false);
  const [gatewayRecoveryNote, setGatewayRecoveryNote] = useState("");
  const [depositTrackerNow, setDepositTrackerNow] = useState(() => Date.now());

  useEffect(() => {
    const terminalExpiry = deposits
      .filter((deposit) => deposit.status === "confirmed" || deposit.status === "failed")
      .map((deposit) => Date.parse(deposit.updatedAt) + 15_000)
      .filter((expiry) => Number.isFinite(expiry) && expiry > Date.now())
      .sort((a, b) => a - b)[0];
    if (!terminalExpiry) return;
    const timer = window.setTimeout(() => setDepositTrackerNow(Date.now()), Math.max(250, terminalExpiry - Date.now() + 50));
    return () => window.clearTimeout(timer);
  }, [deposits, depositTrackerNow]);

  const trackedDeposits = deposits.filter((deposit) => {
    if (deposit.status !== "confirmed" && deposit.status !== "failed") return true;
    const updatedAt = Date.parse(deposit.updatedAt);
    return Number.isFinite(updatedAt) && depositTrackerNow - updatedAt < 15_000;
  });

  const entries = useMemo<LedgerEntry[]>(() => {
    const payments = invoices.map((item): LedgerEntry => {
      const settlement = item.paymentSessionId ? paymentSessions.find((session) => session.id === item.paymentSessionId)?.fiatSettlement : null;
      return {
      id: item.id,
      activity: item.fundingMethod === "fiat_bank" ? `Verified sandbox payout to ${item.recipientLabel}` : `Payment to ${item.recipientLabel}`,
      detail: item.memo || `${fundingLabel(item.fundingMethod)} settlement`,
      kind: item.fundingMethod === "cctp_bridge" ? "cctp" : item.fundingMethod === "unified_balance" ? "gateway" : item.fundingMethod === "fiat_bank" ? "fiat" : "transfer",
      rail: item.fundingMethod === "cctp_bridge" ? "CCTP V2" : item.fundingMethod === "unified_balance" ? "Gateway spend" : item.fundingMethod === "fiat_bank" ? "Circle sandbox + Arc Testnet" : "Direct transfer",
      amount: item.amount,
      txHash: item.txHash,
      explorerUrl: item.explorerUrl,
      receiptUrl: `/invoice/${item.id}`,
      status: "confirmed",
      createdAt: item.createdAt,
      logs: item.bridgeSteps?.length
        ? item.bridgeSteps.map((step) => ({ name: step.name, txHash: step.txHash, explorerUrl: step.explorerUrl }))
        : item.fundingMethod === "fiat_bank"
          ? settlement?.mode === "web3_to_fiat" ? [
              { name: "Payer USDC deposit", txHash: settlement.payerTransferTxHash ?? undefined, explorerUrl: settlement.payerTransferTxHash ? `https://testnet.arcscan.app/tx/${settlement.payerTransferTxHash}` : undefined },
              { name: `Circle inbound ${settlement.circleInboundTransferId ?? "proof unavailable"}` },
              { name: `Circle payout ${settlement.circlePayoutId ?? "proof unavailable"}` },
              { name: `Bank tracking ${settlement.circlePayoutTrackingRef ?? "pending"}` },
            ] : [
              { name: `Circle wire ${settlement?.mockWireTrackingRef ?? "proof unavailable"}` },
              { name: `Circle deposit ${settlement?.circleDepositId ?? "proof unavailable"}` },
              { name: `Wallet payout ${settlement?.receiverTransferId ?? "proof unavailable"}` },
              { name: "Verified USDC transfer", txHash: item.txHash, explorerUrl: item.explorerUrl },
            ]
          : [{ name: item.protocol === "gateway" ? "Gateway settlement" : "Direct settlement", txHash: item.txHash, explorerUrl: item.explorerUrl }],
      meta: item.fundingMethod === "fiat_bank" ? {
        circleDepositId: settlement?.circleDepositId,
        circleDepositStatus: settlement?.circleDepositStatus,
        circleDepositAmount: settlement?.circleDepositAmount,
        receiverTransferId: settlement?.receiverTransferId,
        arcBlockNumber: settlement?.arcBlockNumber,
        fiatMode: settlement?.mode,
        payerTransferTxHash: settlement?.payerTransferTxHash,
        circleInboundTransferId: settlement?.circleInboundTransferId,
        circleInboundTransferStatus: settlement?.circleInboundTransferStatus,
        circlePayoutId: settlement?.circlePayoutId,
        trackingRef: settlement?.circlePayoutTrackingRef ?? settlement?.mockWireTrackingRef,
      } : undefined,
    };
    });
    const pendingCctp = cctpOperations.filter((operation) => isSubmittedCctpOperation(operation) && (!operation.invoiceId || !invoices.some((invoice) => invoice.id === operation.invoiceId))).map((operation): LedgerEntry => ({
      id: `cctp-${operation.id}`,
      activity: `CCTP to ${operation.recipientLabel}`,
      detail: cctpStatusDetail(operation),
      kind: "cctp", rail: "CCTP V2", amount: operation.amount,
      txHash: operation.mintTxHash ?? operation.burnTxHash ?? "",
      explorerUrl: operation.mintExplorerUrl ?? operation.burnExplorerUrl ?? "",
      status: operation.status === "confirmed" ? "confirmed" : operation.status === "failed" ? "failed" : "pending",
      createdAt: operation.createdAt,
      logs: [{ name: "Source burn submitted", txHash: operation.burnTxHash ?? undefined, explorerUrl: operation.burnExplorerUrl ?? undefined }],
    }));
    const allPayments = [...pendingCctp, ...payments];
    const fiatEntries = fiatPayouts.map((payout): LedgerEntry => ({
      id: `fiat-${payout.id}`,
      activity: payout.paymentSessionId ? "Sandbox bank payout" : "Circle Mint wire payout",
      detail: payout.reference || (payout.destinationName ?? "Bank settlement"),
      kind: "fiat",
      rail: payout.destinationName ? `Circle Mint → ${payout.destinationName}` : "Circle Mint wire payout",
      amount: payout.amount,
      txHash: payout.circlePayoutId ?? payout.id,
      explorerUrl: "",
      status: payout.status,
      createdAt: payout.createdAt,
      logs: [
        { name: `Payout ${payout.status}`, txHash: payout.circlePayoutId ?? undefined },
        payout.trackingRef ? { name: `Tracking ${payout.trackingRef}` } : { name: `Sandbox wire submitted` },
      ],
      meta: {
        circlePayoutId: payout.circlePayoutId,
        bankAccountId: payout.bankAccountId,
        sourceWalletId: payout.sourceWalletId,
        trackingRef: payout.trackingRef,
      },
    }));
    const ledger = [...fiatEntries, ...allPayments];
    return [...deposits.map(gatewayDepositLedgerEntry), ...ledger];
  }, [cctpOperations, deposits, fiatPayouts, invoices, paymentSessions]);

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries
      .filter((entry) => filter === "all" || entry.kind === filter)
      .filter((entry) => !normalized || [entry.activity, entry.detail, entry.rail, entry.txHash].some((value) => value.toLowerCase().includes(normalized)))
      .map((entry) => ({
        ...entry,
        activity: historyLabelForViewer(entry.activity, viewer, walletAddress),
        detail: historyLabelForViewer(entry.detail, viewer, walletAddress),
        logs: entry.logs.map((log) => ({ ...log, name: historyLabelForViewer(log.name, viewer, walletAddress) })),
      }))
      .sort((a, b) => sort === "newest" ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : sort === "oldest" ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : sort === "amount_high" ? Number(b.amount) - Number(a.amount)
            : Number(a.amount) - Number(b.amount));
  }, [entries, filter, query, sort, viewer, walletAddress]);

  const onchainEntries = entries.filter((entry) => entry.kind !== "fiat" && Boolean(entry.txHash) && entry.status !== "failed");
  const volume = onchainEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  const confirmed = entries.filter((entry) => entry.status === "confirmed").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const pending = entries.length - confirmed - failed;
  const rails = new Set(entries.map((entry) => entry.rail)).size;

  async function copyHash(hash: string) {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    window.setTimeout(() => setCopiedHash(""), 1_500);
  }

  async function recoverHash() {
    setManualRecoveryBusy(true); setManualRecoveryNote("");
    try {
      const result = await api<{ imported: number; confirmed: number }>("/api/cctp-operations/recover", { method: "POST", body: JSON.stringify({ sourceChain: recoveryChain, txHash: recoveryHash }) });
      setManualRecoveryNote(result.imported > 0 ? `Transfer restored${result.confirmed ? " and confirmed on Arc Testnet" : "; live tracking is active"}.` : "That burn is already tracked.");
      onRefreshCctp();
    } catch (error) {
      setManualRecoveryNote(error instanceof Error ? error.message : "Could not recover that CCTP transaction");
    } finally {
      setManualRecoveryBusy(false);
    }
  }

  async function recoverGatewayDeposit(event: FormEvent) {
    event.preventDefault();
    setGatewayRecoveryBusy(true); setGatewayRecoveryNote("");
    try {
      await api("/api/gateway-deposits", { method: "POST", body: JSON.stringify({ sourceAddress: walletAddress, sourceChain: gatewayRecoveryChain, amount: gatewayRecoveryAmount, txHash: gatewayRecoveryHash, explorerUrl: gatewayExplorerUrl(gatewayRecoveryChain, gatewayRecoveryHash) }) });
      setGatewayRecoveryNote("Deposit proof restored. Circle and the source chain will keep updating it in History.");
      setGatewayRecoveryHash(""); setGatewayRecoveryAmount("");
      onRefreshGateway();
    } catch (error) {
      setGatewayRecoveryNote(error instanceof Error ? error.message : "Could not restore this Gateway deposit");
    } finally { setGatewayRecoveryBusy(false); }
  }

  return <section className="history-view">
    <div className="view-heading"><div><span className="section-tag">TRANSACTION INTELLIGENCE</span><h1>History</h1><p>Every real OffGrid settlement, protocol log, and transaction proof in one place.</p></div><div className="history-live-actions"><button className="quiet-refresh" onClick={onRecover} disabled={recovering}>{recovering ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {recovering ? "Scanning chains…" : "Recover CCTP"}</button><span className="live-data-pill"><i /> LIVE TESTNET DATA</span></div></div>
    {(recoveryNote || manualRecoveryNote) && <p className="history-recovery-note"><CircleCheck size={13}/>{manualRecoveryNote || recoveryNote}</p>}
    <form className="cctp-hash-recovery" onSubmit={(event) => { event.preventDefault(); void recoverHash(); }}><div><span className="section-tag">MISSING A CCTP TRANSFER?</span><p>Paste its source-chain burn hash. OffGrid verifies it with Circle and restores the live attestation or destination mint status.</p></div><ChainSelect value={recoveryChain} chains={CCTP_SOURCE_CHAINS.filter((chain) => chain !== "Solana_Devnet")} onChange={(chain) => setRecoveryChain(chain as CctpSourceChain)} /><label><Search size={13}/><input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value.trim())} placeholder="0x source transaction hash" /></label><button type="submit" disabled={manualRecoveryBusy || !/^0x[a-fA-F0-9]{64}$/.test(recoveryHash)}>{manualRecoveryBusy ? <LoaderCircle className="spin" size={12}/> : <Blocks size={12}/>} Track Transfer</button></form>
    <div className="gateway-recovery-toggle"><button onClick={() => setGatewayRecoveryOpen((open) => !open)}><ArrowDownToLine size={14}/> Missing A Gateway Deposit? <ChevronDown className={gatewayRecoveryOpen ? "open" : ""} size={12}/></button>{gatewayRecoveryOpen && <form onSubmit={recoverGatewayDeposit}><ChainSelect value={gatewayRecoveryChain} chains={SOURCE_CHAINS.filter((chain) => chain !== "Solana_Devnet")} onChange={(chain) => setGatewayRecoveryChain(chain)} /><label className="gateway-recovery-amount"><input value={gatewayRecoveryAmount} onChange={(event) => setGatewayRecoveryAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount"/><span>USDC</span></label><label className="gateway-recovery-hash"><Search size={15}/><input value={gatewayRecoveryHash} onChange={(event) => setGatewayRecoveryHash(event.target.value.trim())} placeholder="0x deposit transaction hash"/></label><button type="submit" disabled={gatewayRecoveryBusy || !(Number(gatewayRecoveryAmount) > 0) || !/^0x[a-fA-F0-9]{64}$/.test(gatewayRecoveryHash)}>{gatewayRecoveryBusy ? <LoaderCircle className="spin" size={14}/> : <Radio size={14}/>} Restore Proof</button></form>}{gatewayRecoveryNote && <p>{gatewayRecoveryNote}</p>}</div>
    <CctpOperationsTray operations={cctpOperations} onRefresh={onRefreshCctp} />
    {trackedDeposits.length > 0 && <section className="gateway-deposit-stack history-gateway-deposits">
      <div className="gateway-deposit-stack-head"><div><small>GATEWAY DEPOSIT TRACKING</small><b>{trackedDeposits.filter((deposit) => deposit.status !== "confirmed" && deposit.status !== "failed").length} active, with confirmed results clearing after 15 seconds</b></div><button onClick={onRefreshGateway}><RefreshCw size={12} /> Refresh Proof</button></div>
      {trackedDeposits.slice(0, 4).map((deposit) => {
        const presentation = gatewayDepositPresentation(deposit);
        return <article className={`gateway-status ${deposit.status} ${presentation.delayed ? "delayed" : ""}`} key={deposit.id}>
          <span className="gateway-status-icon">{deposit.status === "confirmed" ? <CircleCheck size={19} /> : deposit.status === "failed" || presentation.delayed ? <Clock size={19} /> : <LoaderCircle className="spin" size={19} />}</span>
          <div><small>{presentation.label.toUpperCase()} <em>{presentation.elapsed}</em></small><b>{displayMoney(deposit.amount)} USDC from {SOURCE_CHAINS.includes(deposit.sourceChain as SourceChain) ? <ChainName chain={deposit.sourceChain as SourceChain} size={17}/> : deposit.sourceChain}</b><code className="gateway-tracking-hash">TX {shortAddress(deposit.txHash, 7)}</code><p>{presentation.detail}</p></div>
          <div className="gateway-status-actions"><a href={gatewayExplorerUrl(deposit.sourceChain as SourceChain, deposit.txHash)} target="_blank" rel="noreferrer">Source Proof <ExternalLink size={12} /></a><button onClick={() => onSelectEntry(gatewayDepositLedgerEntry(deposit))}><Receipt size={12} /> View Proof</button></div>
        </article>;
      })}
    </section>}
    <div className="history-stats">
      <article><small>TOTAL ACTIVITY</small><b>{entries.length}</b><p>{confirmed} confirmed · {pending} in flight · {failed} failed</p></article>
      <article><small>ONCHAIN VOLUME</small><b>{displayMoney(volume)} <em>USDC</em></b><p>Only submitted or confirmed transactions</p></article>
      <article><small>SUCCESS RATE</small><b>{confirmed + failed ? `${Math.round((confirmed / (confirmed + failed)) * 100)}%` : "-"}</b><p>Confirmed versus failed outcomes</p></article>
      <article><small>ACTIVE ROUTES</small><b>{rails}</b><p>Distinct settlement rails used</p></article>
    </div>
    <div className="ledger-panel">
      <div className="ledger-toolbar"><div><b>Activity ledger</b><small>{visibleEntries.length} of {entries.length} transactions</small></div><label className="ledger-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity or transaction ID" /></label><label className="ledger-select"><span>TYPE</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All activity</option><option value="transfer">Direct transfers</option><option value="gateway">Gateway spends</option><option value="cctp">CCTP bridges</option><option value="deposit">Deposits</option><option value="fiat">Bank payouts</option></select><ChevronDown size={12} /></label><label className="ledger-select"><span>SORT</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount_high">Amount: high</option><option value="amount_low">Amount: low</option></select><ChevronDown size={12} /></label></div>
      <div className="ledger-table-wrap"><table className="ledger-table"><thead><tr><th>Status</th><th>Activity / logs</th><th>Route</th><th>Transaction ID</th><th>Date</th><th>Amount</th><th /></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.id}><td><span className={`ledger-status ${entry.status}`}><i />{entry.status}</span></td><td><div className="ledger-activity"><b>{entry.activity}</b><small>{entry.detail}</small><details><summary>{entry.logs.length} protocol {entry.logs.length === 1 ? "log" : "logs"}</summary><div>{entry.logs.map((log, index) => <span key={`${log.name}-${index}`}><i />{log.name}{log.txHash && <em>{shortAddress(log.txHash, 6)}</em>}</span>)}</div></details></div></td><td><span className={`route-badge ${entry.kind}`}>{entry.rail}</span></td><td>{entry.txHash ? <div className="tx-id"><code>{shortAddress(entry.txHash, 7)}</code><button onClick={() => copyHash(entry.txHash)} aria-label="Copy transaction ID">{copiedHash === entry.txHash ? <Check size={12} /> : <Copy size={12} />}</button></div> : <span className="tx-not-submitted">NOT SUBMITTED</span>}</td><td><time>{new Date(entry.createdAt).toLocaleDateString()}<small>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></time></td><td><strong>{displayMoney(entry.amount)}<small>USDC</small></strong></td><td><div className="ledger-actions"><button className="ledger-proof-button" onClick={() => onSelectEntry(entry)}>Proof</button>{entry.receiptUrl ? <a href={entry.receiptUrl} aria-label="Open receipt"><ExternalLink size={13} /></a> : entry.explorerUrl ? <a href={entry.explorerUrl} target="_blank" rel="noreferrer" aria-label="Open transaction"><ExternalLink size={13} /></a> : null}</div></td></tr>)}</tbody></table>{visibleEntries.length === 0 && <div className="ledger-empty"><Receipt size={24} /><b>{entries.length ? "No transactions match these filters" : "No onchain activity yet"}</b><p>{entries.length ? "Adjust the search, type, or sorting controls." : "Completed transfers and Gateway deposits will appear here automatically."}</p></div>}</div>
    </div>
  </section>;
}

function UnifiedBalanceView({ walletAddress, walletOnArc, arcBalance, unifiedBalance, pendingBalance, chainBalances, gatewayError, gatewayStale, gatewayLoading, solanaAddress, solanaWalletName, solanaUsdcBalance, solanaBusy, onRefresh, onDeposit, onConnect, onConnectSolana }: { walletAddress: string; walletOnArc: boolean; arcBalance: string | null; unifiedBalance: string | null; pendingBalance: string | null; chainBalances: GatewayChainBalance[] | null; gatewayError: string; gatewayStale: boolean; gatewayLoading: boolean; solanaAddress: string; solanaWalletName: string; solanaUsdcBalance: string | null; solanaBusy: boolean; onRefresh: () => void; onDeposit: () => void; onConnect: () => void; onConnectSolana: () => void }) {
  const confirmed = Number(unifiedBalance ?? 0);
  const pending = Number(pendingBalance ?? 0);
  const total = confirmed + pending;
  const confirmedShare = total > 0 ? Math.min(100, (confirmed / total) * 100) : 0;
  const pendingShare = total > 0 ? Math.min(100, (pending / total) * 100) : 0;
  const positions = chainBalances ?? SOURCE_CHAINS.map((chain) => ({ chain, confirmed: "0", pending: "0", queried: chain !== "Solana_Devnet" }));
  return <section className="unified-view">
    <div className="view-heading"><div><span className="section-tag">CIRCLE GATEWAY</span><h1>Unified Balance</h1><p>One spendable USDC balance assembled from supported testnet chains.</p></div>{walletAddress && <button className="quiet-refresh" onClick={onRefresh}><RefreshCw size={13} /> Refresh Balances</button>}</div>
    {!walletAddress ? <div className="unified-empty"><Network size={30} /><h2>Connect a wallet to query Gateway.</h2><p>OffGrid will read only real confirmed and pending balances for your connected address.</p><button className="neon-button" onClick={onConnect}><Wallet size={15} /> Connect Wallet</button></div> : <>
      <section className={`unified-hero ${gatewayStale ? "stale" : ""} ${gatewayLoading ? "loading" : ""}`}>
        <div className="unified-position">
          <span><Network size={18} /></span>
          <small>TOTAL GATEWAY POSITION</small>
          <b>{displayMoney(total)} <em>USDC</em></b>
          <p>{gatewayLoading ? "Reading your live Circle Gateway position" : gatewayError || (unifiedBalance === null ? "Connect your wallet to load a live Gateway balance" : pending > 0 ? "Your confirmed balance is ready while new deposits finish indexing" : "Your confirmed spendable balance across supported chains")}</p>
        </div>
        <div className="unified-breakdown">
          <div className="unified-balance-metrics">
            <span><small>SPENDABLE NOW</small><b>{displayMoney(confirmed)} <em>USDC</em></b></span>
            <span className={pending > 0 ? "active" : ""}><small>PENDING INDEXING</small><b>{displayMoney(pending)} <em>USDC</em></b></span>
          </div>
          <div className="unified-balance-track" aria-label={`${displayMoney(confirmed)} USDC confirmed and ${displayMoney(pending)} USDC pending`}>
            <i className="confirmed" style={{ width: `${confirmedShare}%` }} />
            <i className="pending" style={{ width: `${pendingShare}%` }} />
          </div>
          <p>{pending > 0 ? "Circle Gateway is finalizing the pending source deposits shown below." : "No deposits are waiting for Gateway finality."}</p>
        </div>
        <button className="session-launch-button unified-deposit-cta" onClick={onDeposit}>
          <span><ArrowDownToLine size={18} /></span>
          <div><small>ADD LIQUIDITY</small><b>Deposit USDC</b><em>Choose A Source Chain</em></div>
          <ArrowRight size={17} />
        </button>
      </section>
      <div className="unified-chain-head"><div><span className="section-tag">SOURCE ALLOCATION</span><h2>Balance by chain</h2><p>Live Gateway positions returned by Circle App Kit for this connected account.</p></div><span><i /> CONFIRMED <i /> PENDING</span></div>
      <div className="unified-chain-grid">{positions.map((position) => {
        const chainConfirmed = Number(position.confirmed);
        const chainPending = Number(position.pending);
        const chainTotal = chainConfirmed + chainPending;
        const chainConfirmedShare = chainTotal > 0 ? Math.min(100, (chainConfirmed / chainTotal) * 100) : 0;
        const chainPendingShare = chainTotal > 0 ? Math.min(100, (chainPending / chainTotal) * 100) : 0;
        return <article className={!position.queried ? "unlinked" : chainPending > 0 ? "indexing" : ""} key={position.chain}>
          <div className="unified-chain-logo"><ChainLogo chain={position.chain} size={33}/></div>
          <div><small>{CHAIN_LABELS[position.chain].toUpperCase()}</small><b>{position.queried ? displayMoney(position.confirmed) : "-"} <em>USDC</em></b><p>{!position.queried ? "Connect Solana Wallet To Query" : chainPending > 0 ? `${displayMoney(position.pending)} USDC awaiting finality` : "Gateway confirmed"}</p></div>
          {position.queried && chainPending > 0 && <div className="unified-chain-progress has-pending" aria-label={`${displayMoney(chainConfirmed)} USDC confirmed and ${displayMoney(chainPending)} USDC pending`}><i className="confirmed" style={{ width: `${chainConfirmedShare}%` }} /><i className="pending" style={{ width: `${chainPendingShare}%` }} /></div>}
          <span className={chainPending > 0 ? "pending" : "online"}><i />{chainPending > 0 ? "INDEXING" : position.queried ? "LIVE" : "UNLINKED"}</span>
        </article>;
      })}</div>
      <div className="unified-wallet-balance"><ChainLogo chain="Arc_Testnet" size={25}/><div><small>ARC TESTNET WALLET · OUTSIDE GATEWAY</small><b>{arcBalance === null ? "-" : displayMoney(arcBalance)} USDC</b></div><span>{walletOnArc ? "ARC TESTNET ACTIVE" : "CONNECTED ON ANOTHER CHAIN"}</span></div>
      {!solanaAddress && <div className="unified-wallet-balance solana-wallet-balance"><ChainLogo chain="Solana_Devnet" size={25}/><div><small>SOLANA DEVNET SOURCE WALLET</small><b className="wallet-balance-prompt">Connect Solana to deposit or bridge USDC</b></div><button onClick={onConnectSolana} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={12}/> : <Wallet size={12}/>} Connect Solana</button></div>}
    </>}
  </section>;
}

function CctpOperationsTray({ operations, onRefresh }: { operations: CctpOperation[]; onRefresh: () => void }) {
  const visible = operations.filter((operation) => isSubmittedCctpOperation(operation) && operation.status !== "confirmed").slice(0, 5);
  if (!visible.length) return null;
  const stage = (status: CctpOperation["status"]) => status === "awaiting_signature" ? "Wallet signature" : status === "attesting" ? "Circle attestation" : status === "minting" ? "Forwarder mint" : "Needs attention";
  return <section className="cctp-operations-tray">
    <div className="cctp-tray-head"><div><span><Blocks size={15}/><i /></span><div><small>ONCHAIN CCTP TRACKER</small><b>{visible.length} submitted CCTP {visible.length === 1 ? "transfer" : "transfers"} being tracked</b><p>Only source-chain burns appear here. Preflight and wallet errors are never transaction history.</p></div></div><button onClick={onRefresh}><RefreshCw size={12}/> Refresh Status</button></div>
    <div className="cctp-operation-list">{visible.map((operation) => <article className={operation.status} key={operation.id}>
      <ChainLogo chain={operation.sourceChain} size={28}/><div className="cctp-operation-main"><span><b>{displayMoney(operation.amount)} USDC</b><i><ArrowRight size={10}/></i><ChainName chain="Arc_Testnet" size={15}/></span><small>TO {operation.recipientLabel} · {shortAddress(operation.recipientAddress)}</small></div>
      <div className="cctp-operation-stage"><span><i />{stage(operation.status)}</span><small>{operation.status === "failed" ? cctpStatusDetail(operation) : operation.status === "attesting" ? "Waiting for source confirmation" : operation.status === "minting" ? "Circle is submitting the destination mint" : "Status is stored securely"}</small></div>
      {operation.burnExplorerUrl ? <a href={operation.burnExplorerUrl} target="_blank" rel="noreferrer">Source tx <ExternalLink size={11}/></a> : <span className="cctp-no-hash">{shortAddress(operation.burnTxHash!, 6)}</span>}
    </article>)}</div>
  </section>;
}

interface EscrowItem {
  id: string;
  visibility?: "public" | "private";
  title: string;
  category: "code" | "digital_goods" | "api_key" | "freelance";
  clientAddress: string;
  clientName: string;
  providerAddress: string;
  providerName: string;
  providerUserId?: string;
  amount: string;
  specs: string;
  terms?: { summary?: string; paymentFor?: string; criteria?: string; dueDate?: string; tasks: Array<{ description: string; dueDate?: string; responsibleParty?: string; additionalDetails?: string }> };
  contractFileName?: string;
  contractFileHash?: string;
  status: "initiated" | "deploying" | "open" | "approving" | "locking" | "locked" | "validating" | "releasing" | "settling" | "payout_failed" | "closed" | "refunding" | "refunded" | "failed" | "created" | "funded" | "submitted" | "validated";
  deliverableProof?: string;
  aiVerificationLogs: string[];
  contractAddress?: string;
  circleContractId?: string;
  deploymentTransactionId?: string;
  depositorCircleWalletAddress?: string;
  beneficiaryCircleWalletAddress?: string;
  approvalTransactionId?: string;
  depositTransactionId?: string;
  releaseTransactionId?: string;
  beneficiaryPayoutTransactionId?: string;
  refundTransactionId?: string;
  circleTransactionState?: string;
  paymentId?: number;
  validationResult?: { valid: boolean; confidence: "HIGH" | "MEDIUM" | "LOW"; reasons: string[]; fileName: string; fileHash: string };
  lastError?: string;
  deploymentTxHash?: string;
  approvalTxHash?: string;
  depositTxHash?: string;
  withdrawTxHash?: string;
  beneficiaryPayoutTxHash?: string;
  releaseTxHash?: string;
  refundTxHash?: string;
  createdAt: string;
  updatedAt: string;
}

interface EscrowConfiguration {
  configured: boolean;
  missing: string[];
  blockchain: string;
  usdcAddress: string;
  contractSource: string;
  ai: { provider: "gemini" | "openai"; configured: boolean; missing: string[]; model: string };
}

function LegacyCreateEscrowModal({
  onClose,
  onCreated,
  walletAddress,
}: {
  onClose: () => void;
  onCreated: (item: EscrowItem) => void;
  walletAddress: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EscrowItem["category"]>("code");
  const [providerAddress, setProviderAddress] = useState("");
  const [amount, setAmount] = useState("50.00");
  const [specs, setSpecs] = useState("Automated test suite (npm test) must pass with 0 errors. Code must match TypeScript schema.");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleNext = (e: FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      if (!title.trim()) return setCreateError("Please enter a deliverable title");
      setCreateError("");
      setStep(2);
    } else if (step === 2) {
      if (!providerAddress.trim() || !isAddress(providerAddress)) return setCreateError("Please enter a valid provider EVM wallet address (0x...)");
      if (!amount || Number(amount) <= 0) return setCreateError("Amount must be greater than 0 USDC");
      setCreateError("");
      setStep(3);
    } else {
      void handleSubmit();
    }
  };

  const handleSubmit = async () => {
    setCreateBusy(true);
    setCreateError("");
    try {
      const data = await api<{ escrow: EscrowItem }>("/api/escrows", {
        method: "POST",
        body: JSON.stringify({ title, category, providerAddress, amount, specs })
      });
      onCreated(data.escrow);
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create escrow agreement");
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div className="overlay">
      <article className="escrow-wizard-modal">
        <button className="modal-x" onClick={onClose} aria-label="Close modal"><X size={18}/></button>
        
        <div className="escrow-wizard-head">
          <span className="section-tag">CIRCLE REFUND PROTOCOL · ARC TESTNET</span>
          <h2>Open an AI escrow.</h2>
          <p>Agree on the work first. OffGrid then provisions participant Circle wallets, deploys the official RefundProtocol, and locks real testnet USDC.</p>
        </div>

        <div className="escrow-stepper">
          <div className={`stepper-step ${step >= 1 ? "active" : ""}`}>
            <span>1</span>
            <small>Agreement</small>
          </div>
          <i className={step >= 2 ? "active" : ""} />
          <div className={`stepper-step ${step >= 2 ? "active" : ""}`}>
            <span>2</span>
            <small>Participants</small>
          </div>
          <i className={step >= 3 ? "active" : ""} />
          <div className={`stepper-step ${step >= 3 ? "active" : ""}`}>
            <span>3</span>
            <small>Validation rules</small>
          </div>
        </div>

        <form onSubmit={handleNext} className="escrow-wizard-body">
          {step === 1 && (
            <div className="wizard-step-pane">
              <label className="wizard-label">
                <span>DELIVERABLE TITLE</span>
                <input
                  className="wizard-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Solana Devnet CCTP Integration Module"
                  autoFocus
                  required
                />
              </label>

              <label className="wizard-label">
                <span>CATEGORY</span>
                <select className="wizard-select" value={category} onChange={(e) => setCategory(e.target.value as any)}>
                  <option value="code">Source Code / Repository</option>
                  <option value="api_key">API Key / Endpoint Proxy</option>
                  <option value="digital_goods">Digital Asset / Design</option>
                  <option value="freelance">Freelance Task / Service</option>
                </select>
              </label>

              <div className="wizard-info-box">
                <FileCode size={18} />
                <div>
                  <b>Same sequence as Circle&apos;s official sample</b>
                  <p>Create the agreement, deploy a RefundProtocol contract, lock USDC, submit image evidence, validate with vision AI, then withdraw or refund onchain.</p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step-pane">
              <label className="wizard-label">
                <span>REGISTERED BENEFICIARY WALLET</span>
                <input
                  className="wizard-input"
                  value={providerAddress}
                  onChange={(e) => setProviderAddress(e.target.value)}
                  placeholder="0x..."
                  autoFocus
                  required
                />
              </label>

              <label className="wizard-label">
                <span>ESCROW AMOUNT (USDC)</span>
                <div className="wizard-amount-input">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="50.00"
                    required
                  />
                  <span>USDC</span>
                </div>
                <small className="wizard-field-note">A dedicated Circle SCA wallet is provisioned after the agreement is created.</small>
              </label>

              <div className="wizard-rail-badge">
                <Zap size={14}/>
                <span>Circle developer-controlled wallets · RefundProtocol · Arc Testnet</span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step-pane">
              <label className="wizard-label">
                <span>AI VALIDATION SPECIFICATIONS & RULES</span>
                <textarea
                  className="wizard-textarea"
                  value={specs}
                  onChange={(e) => setSpecs(e.target.value)}
                  placeholder="Define test commands, expected JSON output, or quality rules..."
                  rows={3}
                  required
                />
              </label>

              <div className="escrow-trust-card">
                <small className="section-tag">EXECUTION & TRUST GUARANTEE</small>
                <div className="trust-features">
                  <div>
                    <Lock size={15} />
                    <span><b>Contract Lock</b><small>Depositor approves and pays RefundProtocol</small></span>
                  </div>
                  <div>
                    <Bot size={15} />
                    <span><b>Vision Validation</b><small>Beneficiary submits image evidence against these rules</small></span>
                  </div>
                  <div>
                    <CheckCircle2 size={15} />
                    <span><b>Onchain Release</b><small>HIGH-confidence validation calls withdraw([0])</small></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {createError && <p className="inline-error"><CircleAlert size={13}/> {createError}</p>}

          <div className="wizard-actions">
            {step > 1 ? (
              <button type="button" className="wizard-back-btn" onClick={() => { setCreateError(""); setStep((s) => (s - 1) as any); }}>
                Back
              </button>
            ) : <span />}

            {step < 3 ? (
              <button type="submit" className="neon-button">
                Continue to Step {step + 1} <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className="neon-button wizard-deploy-btn" disabled={createBusy} onClick={() => void handleSubmit()}>
                {createBusy ? <LoaderCircle className="spin" size={16} /> : <Scale size={16} />} Create escrow agreement
              </button>
            )}
          </div>
        </form>
      </article>
    </div>
  );
}

function CreateEscrowModal({ onClose, onCreated }: { onClose: () => void; onCreated: (item: EscrowItem) => void; walletAddress: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [privatePost, setPrivatePost] = useState(false);
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<DirectoryUser[]>([]);
  const [providerAddress, setProviderAddress] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [terms, setTerms] = useState<any>(null);
  const [fileHash, setFileHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!privatePost || query.length < 2) return setProviders([]);
    const timer = window.setTimeout(() => {
      void api<{ users: DirectoryUser[] }>(`/api/users?query=${encodeURIComponent(query)}`).then((data) => setProviders(data.users || [])).catch(() => setProviders([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [privatePost, query]);

  const analyze = async (selected: File) => {
    setFile(selected); setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", selected);
      const data = await api<{ terms: any; fileHash: string }>("/api/escrows/analyze", { method: "POST", body: form });
      setTerms(data.terms); setFileHash(data.fileHash); setStep(3);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not analyze agreement"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const data = await api<{ escrow: EscrowItem }>("/api/escrows", { method: "POST", body: JSON.stringify({ visibility: privatePost ? "private" : "public", providerAddress: privatePost ? providerAddress : undefined, title: terms.title, category: terms.category, amount: terms.amount, specs: terms.criteria, terms, contractFileName: file?.name, contractFileHash: fileHash }) });
      onCreated(data.escrow); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create agreement"); }
    finally { setBusy(false); }
  };

  const labels = ["Publish", "Agreement", "Review"];
  const canContinue = !privatePost || Boolean(providerAddress);
  return <div className="overlay escrow-create-overlay"><article className="escrow-wizard-modal escrow-wizard-premium">
    <div className="escrow-modal-top"><div><span className="section-tag">REFUNDPROTOCOL</span><small>ARC TESTNET</small></div><button className="modal-x" onClick={onClose} aria-label="Close modal"><X size={18}/></button></div>
    <header className="escrow-wizard-head"><h2>Post protected work</h2><p>Publish a job to the marketplace or invite one verified user. Funds move only after the job is accepted and you approve the escrow.</p></header>
    <div className="escrow-stepper premium-stepper">{labels.map((label, index) => <div key={label} className={`stepper-step ${step >= index + 1 ? "active" : ""} ${step > index + 1 ? "complete" : ""}`}><span>{step > index + 1 ? <Check size={12}/> : index + 1}</span><small>{label}</small></div>)}</div>
    <form className="escrow-wizard-body premium-wizard-body" onSubmit={(event) => { event.preventDefault(); if (step === 1 && canContinue) setStep(2); else if (step === 3 && terms) void submit(); }}>
      {step === 1 && <div className="wizard-step-pane"><div className="wizard-pane-title"><BriefcaseBusiness size={19}/><div><b>Choose who can see the job</b><small>Jobs are public by default. Turn on private invite to assign one verified user.</small></div></div><div className="escrow-publish-default"><Globe2 size={17}/><span><b>{privatePost ? "Private job" : "Public marketplace"}</b><small>{privatePost ? "Only the selected user can access it" : "Any verified user can review and accept it"}</small></span><CheckCircle2 size={16}/></div><label className="escrow-private-toggle"><input type="checkbox" checked={privatePost} onChange={(event) => { setPrivatePost(event.target.checked); if (!event.target.checked) { setProviderAddress(""); setQuery(""); } }}/><i/><span><b>Send as a private invite</b><small>Hide this job from the public marketplace</small></span></label>{privatePost && <div className="escrow-private-picker"><label className="wizard-label"><span>INVITE A VERIFIED USER</span><div className="wizard-search-wrap"><Search size={16}/><input className="wizard-input" value={query} onChange={(event) => { setQuery(event.target.value); setProviderAddress(""); }} placeholder="Search name or @username" autoFocus /></div></label><div className="escrow-recipient-results">{providers.map((provider) => <button type="button" className={`escrow-recipient-option ${providerAddress === provider.walletAddress ? "selected" : ""}`} key={provider.id} onClick={() => { setProviderAddress(provider.walletAddress); setQuery(provider.displayName); setProviders([]); }}><span className="recipient-avatar"><UserRound size={17}/></span><span><b>{provider.displayName}</b><small>@{provider.username} · {shortAddress(provider.walletAddress,6)}</small></span><CheckCircle2 size={16}/></button>)}</div></div>}<div className="wizard-route-preview"><span><Wallet size={15}/> Creator funds</span><ArrowRight size={14}/><span><Scale size={15}/> RefundProtocol locks</span><ArrowRight size={14}/><span><UserRound size={15}/> Worker receives</span></div></div>}
      {step === 2 && <div className="wizard-step-pane"><div className="wizard-pane-title"><FileCheck size={19}/><div><b>Add the job agreement</b><small>Upload the scope so OffGrid can structure the amount, deliverables, and validation rules.</small></div></div><label className={`escrow-dropzone ${busy ? "busy" : ""}`}><input type="file" accept=".pdf,.docx,image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void analyze(selected); }}/><span className="dropzone-icon">{busy ? <LoaderCircle className="spin" size={22}/> : <ArrowUpRight size={22}/>}</span><b>{busy ? "Analyzing agreement..." : file?.name || "Choose an agreement"}</b><small>{busy ? "Extracting job terms and acceptance rules" : "PDF, DOCX, PNG, JPG or WEBP · up to 10 MB"}</small></label>{busy && <div className="escrow-upload-progress" role="status"><span><LoaderCircle className="spin" size={14}/> Reading agreement</span><i><b/></i><small>The review step opens when analysis is complete.</small></div>}</div>}
      {step === 3 && terms && <div className="wizard-step-pane"><div className="wizard-pane-title"><ShieldCheck size={19}/><div><b>Review the job post</b><small>Confirm the public details and the rules used for settlement.</small></div></div><div className="escrow-review-grid"><label className="wizard-label wide"><span>JOB TITLE</span><input className="wizard-input" value={terms.title} onChange={(event) => setTerms({ ...terms, title: event.target.value })}/></label><label className="wizard-label"><span>BUDGET</span><div className="wizard-amount-input"><input value={terms.amount} onChange={(event) => setTerms({ ...terms, amount: event.target.value.replace(/[^0-9.]/g, "") })}/><span>USDC</span></div></label><div className="escrow-review-metric"><small>DELIVERABLES</small><b>{terms.tasks?.length || 0}</b></div><label className="wizard-label wide"><span>ACCEPTANCE CRITERIA</span><textarea className="wizard-textarea" value={terms.criteria} onChange={(event) => setTerms({ ...terms, criteria: event.target.value })} rows={3}/></label></div><div className="wizard-publish-summary"><span className={privatePost ? "private" : "public"}>{privatePost ? <LockKeyhole size={14}/> : <Globe2 size={14}/>} {privatePost ? `Private invite for ${query}` : "Public marketplace post"}</span><small>You fund the escrow after a worker accepts. Posting does not move money.</small></div></div>}
      {error && <p className="inline-error"><CircleAlert size={13}/> {error}</p>}
      <footer className="wizard-actions"><button type="button" className="wizard-back-btn" disabled={step === 1 || busy} onClick={() => setStep((value) => (value - 1) as 1 | 2 | 3)}>Back</button><span className="wizard-step-count">{step} OF 3</span>{step === 1 ? <button type="submit" className="neon-button" disabled={!canContinue}>Continue <ArrowRight size={15}/></button> : step === 2 ? <span/> : <button type="submit" className="neon-button wizard-deploy-btn" disabled={busy || !terms?.criteria || Number(terms?.amount) <= 0}>{busy ? <LoaderCircle className="spin" size={16}/> : <BriefcaseBusiness size={16}/>} Publish job</button>}</footer>
    </form>
  </article></div>;
}

function LegacyEscrowView({
  walletAddress,
  arcBalance,
  onConnect,
  onRefresh,
}: {
  walletAddress: string;
  arcBalance: string | null;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  const [escrows, setEscrows] = useState<EscrowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [activeEscrow, setActiveEscrow] = useState<EscrowItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deliverableInput, setDeliverableInput] = useState("");
  const [proofTxHash, setProofTxHash] = useState("");

  const loadEscrows = async () => {
    try {
      const data = await api<{ escrows: EscrowItem[] }>("/api/escrows");
      setEscrows(data.escrows || []);
    } catch {
      setEscrows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEscrows();
  }, []);

  const handleAction = async (item: EscrowItem, action: "fund" | "submit" | "verify" | "refund") => {
    setActionBusy(true);
    try {
      const data = await api<{ escrow: EscrowItem }>("/api/escrows", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, action, txHash: proofTxHash.trim() || undefined, deliverableProof: deliverableInput })
      });
      setEscrows((prev) => prev.map((e) => (e.id === data.escrow.id ? data.escrow : e)));
      if (activeEscrow?.id === data.escrow.id) setActiveEscrow(data.escrow);
      setDeliverableInput("");
      setProofTxHash("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Escrow action failed");
    } finally {
      setActionBusy(false);
    }
  };

  const tvl = escrows.filter((e) => e.status === "funded" || e.status === "submitted").reduce((sum, e) => sum + Number(e.amount), 0);
  const totalSettled = escrows.filter((e) => e.status === "validated").reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <section className="escrow-view">
      <div className="view-heading">
        <div>
          <span className="section-tag">REFUND PROTOCOL · ERC-8183 SPEC</span>
          <h1>AI Escrow</h1>
          <p>AI-validated digital goods and code delivery escrows with onchain USDC settlement.</p>
        </div>
        <div className="escrow-live-actions">
          <button className="neon-button" onClick={() => setShowCreateModal(true)}>
            <Plus size={15} /> Create AI Escrow
          </button>
        </div>
      </div>

      <div className="escrow-stats-grid">
        <article className="escrow-stat-card">
          <small><Lock size={13}/> ACTIVE COMMITMENTS</small>
          <b>{displayMoney(tvl)} <em>USDC</em></b>
          <p>Declared in participant-owned session records</p>
        </article>
        <article className="escrow-stat-card">
          <small><Scale size={13}/> PROOF RECORDED</small>
          <b>{displayMoney(totalSettled)} <em>USDC</em></b>
          <p>Release evidence recorded; OffGrid never holds funds</p>
        </article>
        <article className="escrow-stat-card">
          <small><Bot size={13}/> AUTOMATED RULES</small>
          <b>RULES <em>READY</em></b>
          <p>Deterministic checks run before any release proof is accepted</p>
        </article>
        <article className="escrow-stat-card">
          <small><Zap size={13}/> ARC FINALITY</small>
          <b>&lt; 1.0s <em>FINALITY</em></b>
          <p>Network characteristic; no release is submitted by OffGrid</p>
        </article>
      </div>

      <div className="escrow-list-panel">
        <div className="ledger-toolbar">
          <div>
            <b>Escrow Sessions</b>
            <small>{escrows.length} AI-monitored contracts</small>
          </div>
        </div>

        {escrows.length === 0 ? (
          <div className="escrow-empty-state">
            <div className="escrow-empty-icon"><Scale size={28} /></div>
            <h3>No Escrow Contracts Yet</h3>
            <p>Create your first proof escrow for digital goods, code repositories, or freelance tasks with onchain transaction evidence.</p>
            <button className="neon-button" onClick={() => setShowCreateModal(true)}>
              <Plus size={15} /> Create AI Escrow Contract
            </button>
          </div>
        ) : (
          <div className="escrow-cards-grid">
            {escrows.map((item) => (
              <div key={item.id} className={`escrow-item-card ${item.status}`}>
                <div className="escrow-card-head">
                  <span className={`escrow-category-badge ${item.category}`}>
                    {item.category === "code" ? <FileCode size={12}/> : item.category === "api_key" ? <Bot size={12}/> : <FileCheck size={12}/>}
                    {item.category.toUpperCase().replace("_", " ")}
                  </span>
                  <span className={`escrow-status-pill ${item.status}`}>
                    <i /> {item.status.toUpperCase()}
                  </span>
                </div>

                <h3>{item.title}</h3>
                <p className="escrow-specs-text">{item.specs}</p>

                <div className="escrow-participants">
                  <div>
                    <small>CLIENT</small>
                    <b>{item.clientName}</b>
                  </div>
                  <ArrowRight size={14} className="arrow-split" />
                  <div>
                    <small>PROVIDER</small>
                    <b>{item.providerName}</b>
                  </div>
                </div>

                <div className="escrow-amount-row">
                  <span>
                    <small>LOCKED AMOUNT</small>
                    <b>{displayMoney(item.amount)} USDC</b>
                  </span>
                  <button className="escrow-detail-btn" onClick={() => setActiveEscrow(item)}>
                    Inspect Contract <ArrowRight size={12}/>
                  </button>
                </div>

                {item.status === "created" && (
                  <div className="escrow-proof-action">
                    <input value={proofTxHash} onChange={(event) => setProofTxHash(event.target.value)} placeholder="Paste the confirmed funding transaction hash" spellCheck={false} />
                    <button className="neon-button escrow-action-full" disabled={actionBusy || !proofTxHash.trim()} onClick={() => void handleAction(item, "fund")}>
                      <Lock size={14}/> Record confirmed funding
                    </button>
                  </div>
                )}

                {item.status === "funded" && (
                  <div className="escrow-inline-submit">
                    <input
                      value={deliverableInput}
                      onChange={(e) => setDeliverableInput(e.target.value)}
                      placeholder="Paste GitHub PR or deliverable URL..."
                    />
                    <button className="neon-button" disabled={actionBusy || !deliverableInput.trim()} onClick={() => void handleAction(item, "submit")}>
                      Submit Deliverable
                    </button>
                  </div>
                )}

                {item.status === "submitted" && (
                  <div className="escrow-proof-action">
                    <input value={proofTxHash} onChange={(event) => setProofTxHash(event.target.value)} placeholder="Paste the confirmed release transaction hash" spellCheck={false} />
                    <button className="neon-button escrow-action-full" disabled={actionBusy || !proofTxHash.trim()} onClick={() => void handleAction(item, "verify")}>
                      <Bot size={15}/> Record verified release
                    </button>
                  </div>
                )}

                {item.status === "validated" && (
                  <div className="escrow-success-banner">
                    <CheckCircle2 size={15}/> Release proof recorded on Arc Testnet
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateEscrowModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newItem) => setEscrows((prev) => [newItem, ...prev])}
          walletAddress={walletAddress}
        />
      )}

      {activeEscrow && (
        <div className="overlay">
          <article className="history-proof-modal">
            <button className="modal-x" onClick={() => setActiveEscrow(null)}><X size={18}/></button>
            <div className="history-proof-head">
              <span className="section-tag">ERC-8183 ESCROW INSPECTOR</span>
              {activeEscrow.depositTxHash && (
                <a className="ledger-proof-link" href={`https://testnet.arcscan.app/tx/${activeEscrow.depositTxHash}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={12}/> View Arc Tx
                </a>
              )}
            </div>

            <h2>{activeEscrow.title}</h2>
            <p>{activeEscrow.specs}</p>

            <div className="history-proof-summary">
              <span><small>STATUS</small><b className={activeEscrow.status}>{activeEscrow.status.toUpperCase()}</b></span>
              <span><small>AMOUNT</small><b>{displayMoney(activeEscrow.amount)} USDC</b></span>
              <span><small>RAIL</small><b>RefundProtocol vault</b></span>
            </div>

            <div className="escrow-audit-logs">
              <small className="section-tag">AI ARBITER AUDIT TRAIL</small>
              {activeEscrow.aiVerificationLogs.map((log, idx) => (
                <div key={idx} className="audit-log-line">
                  <Bot size={12}/> <span>{log}</span>
                </div>
              ))}
            </div>

            {activeEscrow.deliverableProof && (
              <div className="escrow-proof-box">
                <small>DELIVERABLE PROOF</small>
                <code>{activeEscrow.deliverableProof}</code>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function EscrowView({ walletAddress, arcBalance, onConnect, onRefresh }: { walletAddress: string; arcBalance: string | null; onConnect: () => void; onRefresh: () => void }) {
  const [escrows, setEscrows] = useState<EscrowItem[]>([]);
  const [configuration, setConfiguration] = useState<EscrowConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeEscrow, setActiveEscrow] = useState<EscrowItem | null>(null);
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File | undefined>>({});
  const [visibleCount, setVisibleCount] = useState(6);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFullAudit, setShowFullAudit] = useState(false);
  const [escrowSection, setEscrowSection] = useState<"marketplace" | "mine" | "history">("marketplace");
  const [showEscrowWorkspace, setShowEscrowWorkspace] = useState(false);

  const loadEscrows = async (quiet = false) => {
    try {
      const data = await api<{ escrows: EscrowItem[]; configuration: EscrowConfiguration }>("/api/escrows");
      setEscrows(data.escrows || []);
      setConfiguration(data.configuration);
      setActiveEscrow((current) => current ? data.escrows.find((entry) => entry.id === current.id) || current : null);
    } catch (error) {
      if (!quiet) setActionError(error instanceof Error ? error.message : "Unable to load escrow agreements");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { void loadEscrows(); }, []);
  const hasPendingAction = escrows.some((item) => ["deploying", "approving", "locking", "validating", "releasing", "settling", "refunding"].includes(item.status));
  useEffect(() => {
    if (!hasPendingAction) return;
    const timer = window.setInterval(() => { if (!document.hidden) void loadEscrows(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [hasPendingAction]);

  const updateEscrow = (escrow: EscrowItem) => {
    setEscrows((previous) => previous.map((entry) => entry.id === escrow.id ? escrow : entry));
    setActiveEscrow((current) => current?.id === escrow.id ? escrow : current);
  };

  const handleAction = async (item: EscrowItem, action: "claim" | "deploy" | "fund" | "refund" | "refresh" | "complete_payout") => {
    setActionBusy(`${item.id}:${action}`);
    setActionError("");
    try {
      const data = await api<{ escrow: EscrowItem }>("/api/escrows", { method: "PATCH", body: JSON.stringify({ id: item.id, action }) });
      updateEscrow(data.escrow);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Escrow action failed");
    } finally {
      setActionBusy("");
    }
  };

  const fundFromCreatorWallet = async (item: EscrowItem) => {
    setActionBusy(`${item.id}:fund-wallet`); setActionError("");
    try {
      const wallets = await discoverBrowserWallets(); if (!wallets.length) throw new Error("No connected EVM wallet found");
      const provider = wallets[0].provider; const account = await requestWalletAccount(provider); if (account.toLowerCase() !== item.clientAddress.toLowerCase()) throw new Error("Connect the wallet that created this escrow");
      if (!item.depositorCircleWalletAddress) throw new Error("Circle escrow wallet is not ready"); await ensureArcTestnet(provider);
      const fundingAmount = parseUnits(item.amount, ARC.usdcDecimals) + parseUnits("0.10", ARC.usdcDecimals);
      const txData = encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }], functionName: "transfer", args: [item.depositorCircleWalletAddress as `0x${string}`, fundingAmount] });
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: ARC.contracts.usdc, data: txData }] }) as `0x${string}`;
      const receipt = await createPublicClient({ chain: arcTestnet, transport: http(ARC.rpcUrl) }).waitForTransactionReceipt({ hash }); if (receipt.status !== "success") throw new Error("The funding transaction reverted");
      const data = await api<{ escrow: EscrowItem }>("/api/escrows", { method: "PATCH", body: JSON.stringify({ id: item.id, action: "fund" }) }); updateEscrow(data.escrow);
    }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not fund escrow"); }
    finally { setActionBusy(""); }
  };

  const validateEvidence = async (item: EscrowItem) => {
    const file = evidenceFiles[item.id];
    if (!file) return;
    setActionBusy(`${item.id}:validate`);
    setActionError("");
    const body = new FormData();
    body.set("escrowId", item.id);
    body.set("file", file);
    try {
      const response = await fetch("/api/escrows/validate", { method: "POST", body });
      const contentType = response.headers.get("content-type") || "";
      const data = (contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : { error: `Server returned ${response.status} ${response.statusText || "an error page"}. Check the deployment logs.` }) as { escrow?: EscrowItem; error?: string; reasons?: string[] };
      if (!response.ok || !data.escrow) throw new Error([data.error, ...(data.reasons || [])].filter(Boolean).join(" · ") || "Validation failed");
      updateEscrow(data.escrow);
      setEvidenceFiles((current) => ({ ...current, [item.id]: undefined }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Validation failed");
      await loadEscrows(true);
    } finally {
      setActionBusy("");
    }
  };

  const isDepositor = (item: EscrowItem) => item.clientAddress.toLowerCase() === walletAddress.toLowerCase();
  const isBeneficiary = (item: EscrowItem) => item.providerAddress.toLowerCase() === walletAddress.toLowerCase();
  const isParticipant = (item: EscrowItem) => isDepositor(item) || isBeneficiary(item);
  const pending = new Set(["deploying", "approving", "locking", "validating", "releasing", "settling", "refunding"]);
  const tvl = escrows.filter((item) => ["locked", "validating", "releasing", "settling", "payout_failed"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0);
  const settled = escrows.filter((item) => item.status === "closed" && Boolean(item.beneficiaryPayoutTxHash || item.beneficiaryPayoutTransactionId)).reduce((sum, item) => sum + Number(item.amount), 0);
  const flowIndex = (status: EscrowItem["status"]) => status === "initiated" ? 0 : ["deploying", "open"].includes(status) ? 1 : ["approving", "locking", "locked"].includes(status) ? 2 : status === "validating" ? 3 : ["releasing", "settling", "payout_failed", "closed", "refunded"].includes(status) ? 4 : 0;
  const marketplaceEscrows = escrows.filter((item) => item.visibility === "public" && item.status === "initiated" && !item.providerUserId);
  const activeEscrows = escrows.filter((item) => isParticipant(item) && !["closed", "refunded"].includes(item.status));
  const historyEscrows = escrows.filter((item) => isParticipant(item) && ["closed", "refunded"].includes(item.status));
  const sectionEscrows = escrowSection === "marketplace" ? marketplaceEscrows : escrowSection === "mine" ? activeEscrows : historyEscrows;
  const visibleEscrows = sectionEscrows.slice(0, visibleCount);
  useEffect(() => { setVisibleCount(6); }, [escrowSection]);
  useEffect(() => {
    if (!showEscrowWorkspace) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowEscrowWorkspace(false);
        setEscrowSection("marketplace");
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showEscrowWorkspace]);
  const loadMore = () => {
    setLoadingMore(true);
    window.setTimeout(() => { setVisibleCount((count) => count + 6); setLoadingMore(false); }, 320);
  };
  const isLegacyClosedPayout = Boolean(activeEscrow?.status === "closed" && !activeEscrow.beneficiaryPayoutTransactionId && !activeEscrow.beneficiaryPayoutTxHash);
  const inspectorTransactions = activeEscrow ? [
    ["Contract deployed", activeEscrow.deploymentTxHash],
    ["USDC approved", activeEscrow.approvalTxHash],
    ["Funds locked", activeEscrow.depositTxHash],
    ["Contract withdrawal", activeEscrow.withdrawTxHash || (isLegacyClosedPayout ? activeEscrow.releaseTxHash : undefined)],
    ["Beneficiary payout", activeEscrow.beneficiaryPayoutTxHash || (!isLegacyClosedPayout ? activeEscrow.releaseTxHash : undefined)],
    ["Depositor refund", activeEscrow.refundTxHash],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])) : [];
  const inspectorRouteNodes = activeEscrow ? [
    { label: "Contract", address: activeEscrow.contractAddress || "", icon: <Blocks size={14}/> },
    { label: "Creator SCA", address: activeEscrow.depositorCircleWalletAddress || "", icon: <Wallet size={14}/> },
    { label: "Worker SCA", address: activeEscrow.beneficiaryCircleWalletAddress || "", icon: <Wallet size={14}/> },
    { label: "Worker wallet", address: activeEscrow.providerUserId ? activeEscrow.providerAddress : "", icon: <UserRound size={14}/> },
  ] : [];

  return <section className="escrow-view">
    <div className="view-heading escrow-market-heading"><div><span className="section-tag">PROTECTED WORK · ARC TESTNET</span><h1>Escrow Marketplace</h1><p>Discover clearly scoped work with protected funding, verifiable delivery, and onchain settlement.</p><div className="escrow-heading-guide"><span><b>1</b> Review the scope</span><i/><span><b>2</b> Accept protected work</span><i/><span><b>3</b> Deliver and settle</span></div></div><div className="escrow-live-actions"><button className="escrow-workspace-link" onClick={() => { setEscrowSection("mine"); setShowEscrowWorkspace(true); }}><LayoutDashboard size={16}/><span><b>My Escrows</b><small>{activeEscrows.length} active · {historyEscrows.length} completed</small></span></button><button className="session-launch-button escrow-post-job-button" onClick={() => walletAddress ? setShowCreateModal(true) : onConnect()}><span><Plus size={17}/></span><div><small>{walletAddress ? "NEW PROTECTED WORK" : "WALLET REQUIRED"}</small><b>{walletAddress ? "Post a Job" : "Connect Wallet"}</b></div><ArrowRight size={17}/></button></div></div>

    <div className="escrow-stats-grid"><article className="escrow-stat-card"><small><Globe2 size={13}/> OPEN JOBS</small><b>{marketplaceEscrows.length} <em>LISTINGS</em></b><p>Public jobs ready for verified workers</p></article><article className="escrow-stat-card"><small><Lock size={13}/> ACTIVE VALUE</small><b>{displayMoney(tvl)} <em>USDC</em></b><p>Funds secured in active agreements</p></article><article className="escrow-stat-card"><small><Scale size={13}/> SETTLED VALUE</small><b>{displayMoney(settled)} <em>USDC</em></b><p>Confirmed beneficiary wallet payouts</p></article><article className="escrow-stat-card"><small><Zap size={13}/> TESTNET WALLET</small><b>{arcBalance === null ? "Not available" : displayMoney(arcBalance)} <em>USDC</em></b><p>Connected balance available for funding</p></article></div>

      {configuration && (!configuration.configured || !configuration.ai.configured) && <div className="escrow-setup-banner"><ShieldAlert size={18}/><div><b>Live escrow setup is incomplete</b><p>Add {configuration.missing.join(", ")}{!configuration.ai.configured ? ` and ${configuration.ai.missing.join(", ")}` : ""} to Vercel. AI validator: {configuration.ai.provider} · {configuration.ai.model}.</p></div></div>}
    {actionError && <div className="escrow-action-error"><CircleAlert size={15}/><span><b>Escrow action stopped</b>{actionError}</span><button onClick={() => setActionError("")}><X size={13}/></button></div>}

    {showEscrowWorkspace && <div className="overlay escrow-workspace-overlay" role="dialog" aria-modal="true" aria-label="My Escrows">
      <article className="escrow-workspace-dialog">
        <header className="escrow-workspace-header">
          <div className="escrow-workspace-title"><span><LayoutDashboard size={17}/></span><div><b>My Escrows</b><small>Continue active work or review a completed settlement</small></div></div>
          <button className="modal-x" onClick={() => { setShowEscrowWorkspace(false); setEscrowSection("marketplace"); }} aria-label="Close My Escrows"><X size={17}/></button>
        </header>
        <nav className="escrow-workspace-tabs" aria-label="Escrow workspace sections">
          <button className={escrowSection === "mine" ? "active" : ""} onClick={() => setEscrowSection("mine")}><BriefcaseBusiness size={14}/><span>Active Work</span><b>{activeEscrows.length}</b></button>
          <button className={escrowSection === "history" ? "active" : ""} onClick={() => setEscrowSection("history")}><Clock size={14}/><span>History</span><b>{historyEscrows.length}</b></button>
        </nav>
        <div className="escrow-workspace-content">
          <div className="escrow-workspace-intro"><div><span className="section-tag">{escrowSection === "mine" ? "ACTIVE WORK" : "SETTLEMENT HISTORY"}</span><h2>{escrowSection === "mine" ? "Work that needs attention" : "Completed agreements"}</h2></div><p>{escrowSection === "mine" ? "Open an agreement to see its next required action." : "Review final outcomes and verified transaction proofs."}</p></div>
          {sectionEscrows.length === 0 ? <div className="escrow-workspace-empty"><span>{escrowSection === "mine" ? <BriefcaseBusiness size={22}/> : <Clock size={22}/>}</span><b>{escrowSection === "mine" ? "No active escrows" : "No completed escrows"}</b><p>{escrowSection === "mine" ? "Accepted and funded work will appear here." : "Completed and refunded agreements will appear here."}</p></div> : <div className="escrow-workspace-list">{sectionEscrows.map((item) => <article className="escrow-workspace-row" key={item.id}>
            <div className="escrow-workspace-row-main"><span className={`escrow-status-pill ${item.status}`}><i/>{item.status.replaceAll("_", " ").toUpperCase()}</span><h3 title={item.title}>{item.title}</h3><p>{item.providerUserId ? `${item.clientName} to ${item.providerName}` : `${item.clientName} · Waiting for a worker`}</p></div>
            <div className="escrow-workspace-row-stage"><small>CURRENT STEP</small><b>{["Terms", "Contract", "Funded", "Review", "Settled"][flowIndex(item.status)]}</b></div>
            <div className="escrow-workspace-row-value"><small>{item.status === "closed" ? "DELIVERED" : item.status === "refunded" ? "REFUNDED" : "VALUE"}</small><b>{displayMoney(item.amount)} <em>USDC</em></b></div>
            <button className="escrow-workspace-open" onClick={() => { setShowFullAudit(false); setShowEscrowWorkspace(false); setEscrowSection("marketplace"); setActiveEscrow(item); }}>Open Details <ArrowRight size={13}/></button>
          </article>)}</div>}
        </div>
      </article>
    </div>}
    <div className="escrow-market-panel">
      <div className="escrow-market-toolbar">
        <div className="escrow-market-label"><span><Globe2 size={16}/></span><div><b>Public Marketplace</b><small>Open work available to verified OffGrid users</small></div></div><button className="escrow-panel-refresh" onClick={() => { void loadEscrows(); onRefresh(); }}><RefreshCw size={13}/> Refresh Jobs</button>
      </div>
      <div className="escrow-market-intro"><div><span className="section-tag">{escrowSection === "marketplace" ? "OPEN OPPORTUNITIES" : escrowSection === "mine" ? "ACTIVE WORK" : "SETTLEMENT RECORDS"}</span><h2>{escrowSection === "marketplace" ? "Protected work, ready to claim" : escrowSection === "mine" ? "Escrows that need your attention" : "Your completed agreements"}</h2><p>{escrowSection === "marketplace" ? "Compare scope, deliverables, and budget before accepting a listing." : escrowSection === "mine" ? "Continue each agreement from acceptance through funding and delivery." : "Review final status, transaction proofs, and protocol audit trails."}</p></div>{sectionEscrows.length > 0 && <span className="escrow-list-count">SHOWING {Math.min(visibleCount, sectionEscrows.length)} OF {sectionEscrows.length}</span>}</div>
      {loading ? <div className="escrow-loading-state"><LoaderCircle size={72} aria-label="Loading protected work"/><span className="section-tag">SYNCING MARKETPLACE</span><h3>Loading protected work</h3><p>Checking listings, active agreements, and settlement state.</p></div> : sectionEscrows.length === 0 ? <div className="escrow-empty-state"><div className="escrow-empty-icon">{escrowSection === "marketplace" ? <BriefcaseBusiness size={28}/> : escrowSection === "mine" ? <Scale size={28}/> : <Clock size={28}/>}</div><h3>{escrowSection === "marketplace" ? "No public jobs right now" : escrowSection === "mine" ? "No active escrows" : "No completed escrows"}</h3><p>{escrowSection === "marketplace" ? "Post the first job or check again later." : escrowSection === "mine" ? "Post a job or accept one from the marketplace." : "Completed and refunded agreements will appear here."}</p>{escrowSection !== "history" && <button className="neon-button" onClick={() => walletAddress ? setShowCreateModal(true) : onConnect()}><Plus size={15}/> {walletAddress ? "Post a job" : "Connect wallet"}</button>}</div> : <><div className={`escrow-cards-grid ${escrowSection}`}>{visibleEscrows.map((item) => <article key={item.id} className={`escrow-item-card ${item.status} ${item.visibility || "private"}`}>
        <div className="escrow-card-head"><span className={`escrow-category-badge ${item.category}`}>{item.category === "code" ? <FileCode size={12}/> : item.category === "api_key" ? <Bot size={12}/> : <FileCheck size={12}/>}{item.category.toUpperCase().replace("_", " ")}</span><span className={`escrow-status-pill ${item.status}`}><i/>{escrowSection === "marketplace" ? "OPEN" : item.status.replaceAll("_", " ").toUpperCase()}</span></div>
        <div className="escrow-card-copy"><h3 title={item.title}>{item.title}</h3><p className="escrow-specs-text" title={item.terms?.summary || item.specs}>{item.terms?.summary || item.specs}</p><div className={`escrow-task-strip ${item.terms?.tasks?.length ? "" : "empty"}`}><small>{item.terms?.tasks?.length ? `${item.terms.tasks.length} DELIVERABLE${item.terms.tasks.length === 1 ? "" : "S"}` : "FULL BRIEF"}</small><span title={item.terms?.tasks?.[0]?.description || "Open the inspector to read the complete scope and validation rules."}>{item.terms?.tasks?.[0]?.description || "Open the inspector to read the complete scope and validation rules."}</span></div></div>
        {escrowSection !== "marketplace" && <div className="escrow-flow-line">{["Terms", "Contract", "Funded", "Review", "Settled"].map((label, index) => <span key={label} className={index <= flowIndex(item.status) ? "active" : ""}><i>{index < flowIndex(item.status) ? <Check size={9}/> : index + 1}</i><small>{label}</small></span>)}</div>}
        <div className="escrow-participants"><div><small>POSTED BY</small><b>{item.clientName}</b></div><ArrowRight size={14} className="arrow-split"/><div><small>{item.providerUserId ? "WORKER" : "AVAILABILITY"}</small><b>{item.providerUserId ? item.providerName : "Open to verified users"}</b></div></div>
        <div className="escrow-amount-row"><span><small>{["locked", "validating", "releasing", "settling", "payout_failed"].includes(item.status) ? "SECURED AMOUNT" : item.status === "closed" ? "DELIVERED AMOUNT" : "AGREED AMOUNT"}</small><b>{displayMoney(item.amount)} USDC</b></span><button className="escrow-detail-btn" onClick={() => { setShowFullAudit(false); setActiveEscrow(item); }}>Inspect protocol <ArrowRight size={12}/></button></div>
        {item.lastError && <p className="escrow-card-error"><CircleAlert size={12}/>{item.lastError}</p>}
        {escrowSection === "marketplace" && !isDepositor(item) && <button className="neon-button escrow-action-full" disabled={Boolean(actionBusy)} onClick={() => void handleAction(item, "claim")}>{actionBusy === `${item.id}:claim` ? <LoaderCircle className="spin" size={14}/> : <BriefcaseBusiness size={14}/>} Accept job</button>}
        {escrowSection === "marketplace" && isDepositor(item) && <div className="escrow-waiting-banner"><Clock size={14}/> Your listing is waiting for a worker</div>}
        {item.status === "initiated" && isDepositor(item) && Boolean(item.providerUserId) && <button className="neon-button escrow-action-full" disabled={!configuration?.configured || Boolean(actionBusy)} onClick={() => void handleAction(item, "deploy")}>{actionBusy === `${item.id}:deploy` ? <LoaderCircle className="spin" size={14}/> : <Blocks size={14}/>} Deploy RefundProtocol</button>}
        {item.status === "initiated" && !isDepositor(item) && Boolean(item.providerUserId) && <div className="escrow-waiting-banner"><Clock size={14}/> Accepted · waiting for the creator to deploy</div>}
        {item.status === "open" && isDepositor(item) && <div className="escrow-circle-wallet creator-funding-card"><small>READY TO FUND · CONNECTED TESTNET WALLET</small><div className="funding-route"><span>{shortAddress(item.clientAddress)}</span><ArrowRight size={13}/><span>{shortAddress(item.depositorCircleWalletAddress || "")}</span></div><p>You sign one transfer for {displayMoney(Number(item.amount) + .1)} USDC: {displayMoney(item.amount)} is locked and 0.10 remains for network gas. After confirmation, the Circle SCA automatically approves and pays RefundProtocol.</p><button className="neon-button escrow-action-full" disabled={Boolean(actionBusy) || !item.depositorCircleWalletAddress} onClick={() => void fundFromCreatorWallet(item)}>{actionBusy === `${item.id}:fund-wallet` ? <LoaderCircle className="spin" size={14}/> : <Wallet size={14}/>} Fund &amp; lock {displayMoney(item.amount)} USDC</button></div>}
        {item.status === "open" && !isDepositor(item) && <div className="escrow-waiting-banner"><Clock size={14}/> Contract deployed · waiting for depositor funding</div>}
        {item.status === "locked" && isBeneficiary(item) && <div className="escrow-evidence-action"><label><FileCheck size={14}/><span><b>{evidenceFiles[item.id]?.name || "Choose image evidence"}</b><small>PNG, JPG, WEBP · max 5 MB</small></span><input type="file" accept="image/*" onChange={(event) => setEvidenceFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] }))}/></label><div><button className="neon-button" disabled={!evidenceFiles[item.id] || Boolean(actionBusy)} onClick={() => void validateEvidence(item)}>{actionBusy === `${item.id}:validate` ? <LoaderCircle className="spin" size={14}/> : <Bot size={14}/>} Validate &amp; release</button><button className="escrow-refund-button" disabled={Boolean(actionBusy)} onClick={() => void handleAction(item, "refund")}><Unlock size={13}/> Refund depositor</button></div></div>}
        {item.status === "locked" && !isBeneficiary(item) && <div className="escrow-waiting-banner"><Lock size={14}/> Payment 0 locked · waiting for beneficiary evidence</div>}
        {pending.has(item.status) && <div className="escrow-pending-banner"><LoaderCircle className="spin" size={14}/><span><b>{item.status === "deploying" ? "Deploying RefundProtocol" : item.status === "approving" ? "Approving USDC" : item.status === "locking" ? "Locking contract funds" : item.status === "validating" ? "Validating evidence" : item.status === "releasing" ? "Withdrawing from RefundProtocol" : item.status === "settling" ? "Sending to connected wallet" : "Returning funds"}</b><small>{item.circleTransactionState || "Circle transaction queued"} · safe to leave this tab</small></span><button onClick={() => void handleAction(item, "refresh")} disabled={Boolean(actionBusy)}><RefreshCw size={12}/></button></div>}
        {item.status === "payout_failed" && <div className="escrow-payout-recovery"><CircleAlert size={14}/><span><b>Connected-wallet payout needs recovery</b><small>The contract withdrawal is safe in the beneficiary Circle wallet.</small></span><button onClick={() => void handleAction(item, "complete_payout")} disabled={Boolean(actionBusy)}>Retry payout</button></div>}
        {item.status === "closed" && !item.beneficiaryPayoutTransactionId && !item.beneficiaryPayoutTxHash && <div className="escrow-payout-recovery"><CircleAlert size={14}/><span><b>Legacy payout needs one final step</b><small>Forward the released USDC to {shortAddress(item.providerAddress)}.</small></span><button onClick={() => void handleAction(item, "complete_payout")} disabled={Boolean(actionBusy)}>Complete payout</button></div>}
        {item.status === "closed" && (item.beneficiaryPayoutTransactionId || item.beneficiaryPayoutTxHash) && <div className="escrow-success-banner"><CheckCircle2 size={15}/> Beneficiary wallet received the onchain payout</div>}{item.status === "refunded" && <div className="escrow-success-banner"><Unlock size={15}/> Funds returned to the depositor wallet</div>}
      </article>)}</div>{visibleCount < sectionEscrows.length && <div className="escrow-load-more"><button onClick={loadMore} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="spin" size={14}/> : <Plus size={14}/>}<span><b>{loadingMore ? "Loading jobs" : "Load more"}</b><small>{sectionEscrows.length - visibleCount} remaining</small></span></button></div>}</>}
    </div>

    {showCreateModal && <CreateEscrowModal onClose={() => setShowCreateModal(false)} onCreated={(item) => setEscrows((previous) => [item, ...previous])} walletAddress={walletAddress}/>}
    {activeEscrow && <div className="overlay escrow-inspector-overlay"><article className="history-proof-modal escrow-inspector">
      <div className="escrow-inspector-top"><div><span className="section-tag">ESCROW DETAILS</span><small>Verified contract record on Arc Testnet</small></div><button className="modal-x" onClick={() => setActiveEscrow(null)} aria-label="Close inspector"><X size={18}/></button></div>
      <div className="escrow-inspector-body">
      <header className="escrow-inspector-header"><div><span className={`escrow-status-pill ${activeEscrow.status}`}><i/>{activeEscrow.status.replaceAll("_", " ").toUpperCase()}</span><h2>{activeEscrow.title}</h2><p dir="auto">{activeEscrow.specs}</p></div><div className="escrow-value-hero"><small>ESCROW VALUE</small><div><b>{displayMoney(activeEscrow.amount)}</b><UsdcMark size={30}/></div><span>{["locked", "validating", "releasing", "settling", "payout_failed"].includes(activeEscrow.status) ? "Secured in RefundProtocol" : "Budget denominated in USDC"}</span></div></header>
      <div className="escrow-inspector-meta"><span><small>PAYMENT REFERENCE</small><b>#{String((activeEscrow.paymentId ?? 0) + 1).padStart(4, "0")}</b><em>Protocol ID {activeEscrow.paymentId ?? 0}</em></span><span><small>STATUS</small><b className={activeEscrow.status}>{activeEscrow.status.replaceAll("_", " ").toUpperCase()}</b></span><span><small>BENEFICIARY</small><b>{activeEscrow.providerUserId ? activeEscrow.providerName : "Open to applicants"}</b></span></div>
      <div className="escrow-inspector-progress" aria-label="Escrow progress">{["Terms", "Contract", "Funded", "Review", "Settled"].map((label, index) => <span key={label} className={index <= flowIndex(activeEscrow.status) ? "active" : ""}><i>{index < flowIndex(activeEscrow.status) ? <Check size={10}/> : index + 1}</i><small>{label}</small></span>)}</div>
      {(activeEscrow.deliverableProof || activeEscrow.validationResult) && <section className="escrow-inspector-section escrow-evidence-section"><div className="escrow-inspector-section-head"><span className="section-tag">EVIDENCE REVIEW</span><small>Submission and AI decision</small></div><div className="escrow-evidence-panel">{activeEscrow.deliverableProof && <div className="escrow-proof-row"><span className="escrow-evidence-icon"><FileCheck size={17}/></span><div><small>SUBMITTED EVIDENCE</small><b>{activeEscrow.validationResult?.fileName || "Deliverable proof"}</b><code title={activeEscrow.deliverableProof}>{shortAddress(activeEscrow.deliverableProof, 12)}</code></div></div>}{activeEscrow.validationResult && <div className={`escrow-decision-row ${activeEscrow.validationResult.valid ? "valid" : "invalid"}`}><div><span><Bot size={15}/>VISION VALIDATION · {activeEscrow.validationResult.confidence}</span><b>{activeEscrow.validationResult.valid ? "Criteria satisfied" : "Evidence rejected"}</b></div><p dir="auto">{activeEscrow.validationResult.reasons.join(" · ") || "No unmet criteria reported."}</p></div>}</div></section>}
      <div className="escrow-inspector-disclosures">
        <details><summary><span><Blocks size={16}/><b>Onchain Proof</b><small>{inspectorTransactions.length ? `${inspectorTransactions.length} confirmed transaction${inspectorTransactions.length === 1 ? "" : "s"}` : "Waiting for the first transaction"}</small></span><ChevronDown size={15}/></summary><div className="escrow-disclosure-body"><div className="escrow-route-line">{inspectorRouteNodes.map((node, index) => <div className="escrow-route-node-wrap" key={node.label}>{index > 0 && <ArrowRight className="escrow-route-arrow" size={14}/>}<a href={node.address ? `https://testnet.arcscan.app/address/${node.address}` : undefined} target="_blank" rel="noreferrer" className={!node.address ? "disabled" : ""}>{node.icon}<span><small>{node.label}</small><code>{node.address ? shortAddress(node.address, 5) : "Pending"}</code></span>{node.address && <ExternalLink size={11}/>}</a></div>)}</div>{inspectorTransactions.length ? <div className="escrow-tx-list">{inspectorTransactions.map(([label,hash]) => <a key={`${label}-${hash}`} href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer"><span><small>{label}</small><code>{shortAddress(hash, 10)}</code></span><ExternalLink size={13}/></a>)}</div> : <div className="escrow-no-tx">No confirmed transaction yet.</div>}</div></details>
        <details open={showFullAudit} onToggle={(event) => setShowFullAudit(event.currentTarget.open)}><summary><span><Bot size={16}/><b>Activity Log</b><small>{activeEscrow.aiVerificationLogs.length} protocol update{activeEscrow.aiVerificationLogs.length === 1 ? "" : "s"}</small></span><ChevronDown size={15}/></summary><div className="escrow-disclosure-body"><div className="escrow-audit-logs">{activeEscrow.aiVerificationLogs.map((log, index) => <div key={`${log}-${index}`} className="audit-log-line"><Bot size={12}/><span>{log}</span></div>)}</div></div></details>
      </div>
      </div>
    </article></div>}
  </section>;
}

function RevealPanel({ show, children }: { show: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);
  const [settled, setSettled] = useState(show);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimer = 0;
    let unmountTimer = 0;

    if (show) {
      setMounted(true);
      setSettled(false);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setVisible(true));
      });
      settleTimer = window.setTimeout(() => setSettled(true), 260);
    } else {
      setSettled(false);
      setVisible(false);
      unmountTimer = window.setTimeout(() => setMounted(false), 240);
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [show]);

  if (!mounted) return null;

  return (
    <div className={`funding-detail-transition ${visible ? "is-visible" : "is-hiding"} ${settled ? "is-settled" : ""}`} aria-hidden={!show}>
      <div className="funding-detail-transition-inner">{children}</div>
    </div>
  );
}

export function OffGridDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [showWallets, setShowWallets] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletName, setWalletName] = useState("");
  const [chainReady, setChainReady] = useState(false);
  const [walletOnArc, setWalletOnArc] = useState(false);
  const [arcBalance, setArcBalance] = useState<string | null>(null);
  const [unifiedBalance, setUnifiedBalance] = useState<string | null>(null);
  const [pendingBalance, setPendingBalance] = useState<string | null>(null);
  const [gatewayChainBalances, setGatewayChainBalances] = useState<GatewayChainBalance[] | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [showFaucetMenu, setShowFaucetMenu] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [selectedProofEntry, setSelectedProofEntry] = useState<LedgerEntry | null>(null);

  function disconnectSolanaWallet() {
    solanaAdapterRef.current = null;
    setSolanaAddress("");
    setSolanaWalletName("");
    setSolanaUsdcBalance(null);
    setSolanaError("");
    try { window.localStorage.removeItem("offgrid-last-solana-wallet"); } catch { /* Storage can be blocked in private browsing. */ }
  }

  const [gatewayError, setGatewayError] = useState("");
  const [gatewayStale, setGatewayStale] = useState(false);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showFunding, setShowFunding] = useState(false);
  const [depositChain, setDepositChain] = useState<SourceChain>("Base_Sepolia");
  const [depositAmount, setDepositAmount] = useState("10.00");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [gatewayDeposits, setGatewayDeposits] = useState<GatewayDeposit[]>([]);
  const [bridgeSourceChain, setBridgeSourceChain] = useState<CctpSourceChain>("Base_Sepolia");
  const [solanaWallets, setSolanaWallets] = useState<SolanaBrowserWallet[]>([]);
  const [showSolanaWallets, setShowSolanaWallets] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState("");
  const [solanaWalletName, setSolanaWalletName] = useState("");
  const [solanaUsdcBalance, setSolanaUsdcBalance] = useState<string | null>(null);
  const [solanaBusy, setSolanaBusy] = useState(false);
  const [solanaError, setSolanaError] = useState("");
  const [activity, setActivity] = useState<InvoiceData[]>([]);
  const [fiatPayouts, setFiatPayouts] = useState<FiatPayout[]>([]);
  const [activeView, setActiveView] = useState<WorkspaceView>("transfer");
  const [step, setStep] = useState<PayStep>("recipient");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipient, setRecipient] = useState<DirectoryUser | null>(null);
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [fundingMethod, setFundingMethod] = useState<FundingMethod>("arc_wallet");
  const [paymentError, setPaymentError] = useState("");
  const [paymentPhase, setPaymentPhase] = useState<"estimate" | "signature" | "settlement" | "receipt">("estimate");
  const [paymentEstimate, setPaymentEstimate] = useState<PaymentEstimate | null>(null);
  const [gatewayMintRetry, setGatewayMintRetry] = useState<GatewayMintRetry | null>(null);
  const [gatewayMintBusy, setGatewayMintBusy] = useState(false);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [protocolEvents, setProtocolEvents] = useState<ProtocolEvent[]>([]);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [cctpOperations, setCctpOperations] = useState<CctpOperation[]>([]);
  const [cctpRecovering, setCctpRecovering] = useState(false);
  const [cctpRecoveryNote, setCctpRecoveryNote] = useState("");
  const [showSessionCreator, setShowSessionCreator] = useState(false);
  const [showLiveSessionsModal, setShowLiveSessionsModal] = useState(false);
  const [paymentSessionsList, setPaymentSessionsList] = useState<PaymentSessionView[]>([]);
  const [showOnRamp, setShowOnRamp] = useState(false);
  const [sessionIntent, setSessionIntent] = useState<"pay" | "receive">("pay");
  const [sessionRail, setSessionRail] = useState<PaymentRail>("web3_usdc");
  const [sessionAmount, setSessionAmount] = useState("");
  const [sessionMemo, setSessionMemo] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [createdSessionLink, setCreatedSessionLink] = useState("");
  const [sessionLinkCopied, setSessionLinkCopied] = useState(false);
  const [activeSession, setActiveSession] = useState<PaymentSessionView | null>(null);
  const [activeSessionToken, setActiveSessionToken] = useState("");
  const [sessionModalTab, setSessionModalTab] = useState<"open" | "ready" | "completed" | "archived">("open");
  const [sessionNotice, setSessionNotice] = useState<{ id: string; title: string; detail: string } | null>(null);
  const providerRef = useRef<BrowserWallet["provider"] | null>(null);
  const adapterRef = useRef<BrowserViemAdapter | null>(null);
  const solanaAdapterRef = useRef<BrowserSolanaAdapter | null>(null);
  const clientRef = useRef<ArcPayrollClient | null>(null);
  const unsubscribeProgressRef = useRef<(() => void) | null>(null);
  const unsubscribeChainRef = useRef<(() => void) | null>(null);
  const cctpRunsRef = useRef(new Map<string, { burnCaptured: boolean }>());
  const activeCctpFormRef = useRef<string | null>(null);
  const knownCctpInvoicesRef = useRef(new Set<string>());
  const autoReconnectAttemptedRef = useRef(false);
  const solanaAutoReconnectAttemptedRef = useRef(false);
  const sessionSnapshotRef = useRef<Map<string, string> | null>(null);
  const shownSessionEventsRef = useRef<Set<string>>(new Set());
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const hasLiveSession = paymentSessionsList.some((session) => session.status === "open" || session.status === "ready");
  const hasPendingCctp = cctpOperations.some((operation) => operation.status !== "confirmed" && operation.status !== "failed");
  const hasPendingFiat = fiatPayouts.some((payout) => payout.status === "submitted" || payout.status === "pending");
  const hasPendingGatewayDeposit = gatewayDeposits.some((deposit) => deposit.status !== "confirmed" && deposit.status !== "failed");

  function openWorkspaceView(view: WorkspaceView) {
    if (view === activeView) return;
    const update = () => flushSync(() => setActiveView(view));
    const documentWithTransitions = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    if (documentWithTransitions.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      documentWithTransitions.startViewTransition(update);
    } else {
      update();
    }
  }

  function persistWalletProfile(wallet: BrowserWallet, address: string) {
    try {
      window.localStorage.setItem("offgrid-last-evm-wallet", JSON.stringify({
        uuid: wallet.info.uuid,
        rdns: wallet.info.rdns,
        name: wallet.info.name,
        icon: wallet.info.icon,
        address,
      }));
    } catch {
      // localStorage is best-effort only.
    }
  }

  function persistSolanaProfile(wallet: SolanaBrowserWallet, address: string) {
    try {
      window.localStorage.setItem("offgrid-last-solana-wallet", JSON.stringify({
        id: wallet.id,
        name: wallet.name,
        address,
      }));
    } catch {
      // localStorage is best-effort only.
    }
  }

  function readSolanaProfile() {
    try {
      const raw = window.localStorage.getItem("offgrid-last-solana-wallet");
      return raw ? JSON.parse(raw) as { id?: string; name?: string; address?: string } : null;
    } catch {
      return null;
    }
  }

  function readWalletProfile() {
    try {
      const raw = window.localStorage.getItem("offgrid-last-evm-wallet");
      return raw ? JSON.parse(raw) as { uuid?: string; rdns?: string; name?: string; address?: string } : null;
    } catch {
      return null;
    }
  }

  useEffect(() => { api<{ user: User | null }>("/api/auth/me").then(({ user }) => setUser(user)).finally(() => setBooting(false)); }, []);
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem("offgrid-workspace-view") as WorkspaceView | null;
      if (stored && ["transfer", "history", "unified", "mass", "escrow", "agents"].includes(stored)) setActiveView(stored);
    } catch {
      // Session storage is optional in privacy-restricted browsers.
    }
  }, []);
  useEffect(() => {
    try { window.sessionStorage.setItem("offgrid-workspace-view", activeView); } catch { /* Optional persistence. */ }
  }, [activeView]);
  useEffect(() => {
    const profile = readWalletProfile();
    if (!profile?.address) return;
    setWalletAddress(profile.address);
    if (profile.name) setWalletName(profile.name);
  }, []);
  useEffect(() => {
    if (!user?.walletAddress) return;
    setWalletAddress((current) => current || user.walletAddress || "");
  }, [user]);
  useEffect(() => {
    if (!user || solanaAutoReconnectAttemptedRef.current) return;
    solanaAutoReconnectAttemptedRef.current = true;
    const profile = readSolanaProfile();
    if (!profile?.address) return;
    void (async () => {
      try {
        const discovered = discoverSolanaWallets();
        const selected = discovered.find((wallet) => wallet.id === profile.id || wallet.name === profile.name);
        if (!selected) return;
        const address = await reconnectSolanaWallet(selected.provider);
        if (address !== profile.address) return;
        const client = clientRef.current ?? new ArcPayrollClient();
        clientRef.current = client;
        const adapter = await client.connectSolanaWallet(selected.provider);
        solanaAdapterRef.current = adapter;
        setSolanaAddress(address);
        setSolanaWalletName(selected.name);
        try {
          setSolanaUsdcBalance(await client.getSolanaUsdcBalance(adapter, address));
          setSolanaError("");
        } catch (error) {
          setSolanaUsdcBalance(null);
          setSolanaError(describeSolanaReadIssue(error instanceof Error ? error.message : "Could not read Solana Devnet USDC"));
        }
      } catch {
        // Trusted reconnect is silent. A disconnected or locked wallet stays unlinked.
      }
    })();
  }, [user]);
  useEffect(() => {
    if (!user?.walletAddress) return;
    void loadBalances(user.walletAddress);
  }, [user?.walletAddress]);
  useEffect(() => {
    if (autoReconnectAttemptedRef.current) return;
    autoReconnectAttemptedRef.current = true;
    const profile = typeof window === "undefined" ? null : readWalletProfile();
    if (!profile?.address) return;
    void (async () => {
      try {
        const discovered = await discoverBrowserWallets();
        const selected = discovered.find((wallet) => wallet.info.uuid === profile.uuid || wallet.info.rdns === profile.rdns || wallet.info.name === profile.name);
        if (!selected) return;
        await connectWallet(selected);
      } catch {
        // If auto-reconnect fails, the persisted user wallet address still keeps the flow visible.
      }
    })();
  }, [user]);
  useEffect(() => {
    if (!showWalletMenu) return;
    const closeMenu = (event: MouseEvent) => {
      if (!walletMenuRef.current?.contains(event.target as Node)) setShowWalletMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowWalletMenu(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showWalletMenu]);
  useEffect(() => () => {
    unsubscribeProgressRef.current?.();
    unsubscribeChainRef.current?.();
  }, []);
  useEffect(() => { if (user) api<{ invoices: InvoiceData[] }>("/api/invoices").then(({ invoices }) => setActivity(invoices)).catch(() => undefined); }, [user, invoice]);
  useEffect(() => {
    if (user && typeof window !== "undefined" && window.ethereum) {
      window.ethereum.request({ method: "eth_chainId" }).then((chainId) => {
        const isArc = Number.parseInt(String(chainId), 16) === ARC.chainId;
        if (isArc) {
          setWalletOnArc(true);
          setChainReady(true);
        }
      }).catch(() => undefined);
    }
  }, [user]);
  async function refreshPaymentSessions() {
    try {
      const { sessions } = await api<{ sessions: PaymentSessionView[] }>("/api/payment-sessions");
      const previous = sessionSnapshotRef.current;
      if (previous) {
        const changed = sessions.find((session) => {
          const snapshot = sessionEventSnapshot(session);
          const eventKey = `${session.id}:${snapshot}`;
          return previous.has(session.id) && previous.get(session.id) !== snapshot && !shownSessionEventsRef.current.has(eventKey);
        });
        if (changed) {
          const eventKey = `${changed.id}:${sessionEventSnapshot(changed)}`;
          shownSessionEventsRef.current.add(eventKey);
          persistShownSessionEvents(shownSessionEventsRef.current);
          setSessionNotice({
            id: changed.id,
            title: changed.status === "complete" ? "Payment session completed" : changed.status === "ready" ? "Both payment choices are locked" : "Payment session updated",
            detail: changed.nextActionLabel,
          });
        }
      }
      sessionSnapshotRef.current = new Map(sessions.map((session) => [session.id, sessionEventSnapshot(session)]));
      setPaymentSessionsList(sessions);
    } catch {
      // Best effort
    }
  }

  async function archiveSession(tokenHash?: string) {
    if (!tokenHash) return;
    setSessionError("");
    try {
      const { session } = await api<{ session: PaymentSessionView }>(`/api/payment-sessions/${tokenHash}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" }),
      });
      setPaymentSessionsList((curr) => curr.map((s) => s.inviteTokenHash === tokenHash || s.id === session.id ? session : s));
      await refreshPaymentSessions();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not archive session");
    }
  }

  useEffect(() => {
    shownSessionEventsRef.current = readShownSessionEvents();
  }, []);
  useEffect(() => {
    if (!user) return;
    const sync = () => {
      if (document.hidden) return;
      void refreshFiatPayouts();
      void refreshPaymentSessions();
    };
    sync();
    const interval = window.setInterval(sync, hasLiveSession || hasPendingFiat ? 5_000 : 30_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user, hasLiveSession, hasPendingFiat]);
  useEffect(() => {
    if (!sessionNotice) return;
    const timeout = window.setTimeout(() => setSessionNotice(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [sessionNotice]);
  useEffect(() => {
    if (!user) return;
    const sync = () => { if (!document.hidden) void refreshCctpOperations(); };
    sync();
    const interval = hasPendingCctp ? window.setInterval(sync, 12_000) : null;
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user, hasPendingCctp]);
  useEffect(() => {
    if (!user) return;
    const sync = () => { if (!document.hidden) void refreshGatewayDeposits(); };
    sync();
    const interval = hasPendingGatewayDeposit ? window.setInterval(sync, 12_000) : null;
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user, hasPendingGatewayDeposit]);
  useEffect(() => {
    if (!user) return;
    const token = new URLSearchParams(window.location.search).get("session");
    if (!token) return;
    api<{ session: PaymentSessionView }>(`/api/payment-sessions/${encodeURIComponent(token)}`).then(({ session }) => {
      if (session.status !== "ready" || session.actionRole !== "payer") throw new Error("This session is not ready for payment by this account");
      if (session.payerRail !== "web3_usdc" || session.receiverRail !== "web3_usdc") throw new Error("This session requires a configured fiat provider");
      const receiver = session.creatorIntent === "pay" ? session.counterparty : session.creator;
      if (!receiver?.walletAddress) throw new Error("The receiver has not bound a wallet");
      setActiveSession(session); setActiveSessionToken(token);
      setRecipient({ id: receiver.id, username: receiver.username, displayName: receiver.displayName, walletAddress: receiver.walletAddress });
      setRecipientQuery(`@${receiver.username}`); setAmount(session.amount); setMemo(session.memo); setPaymentEstimate(null); setGatewayMintRetry(null); setStep("amount");
      window.setTimeout(() => {
        const consoleElement = document.getElementById("payment-console");
        consoleElement?.scrollIntoView({ behavior: "smooth", block: "start" });
        consoleElement?.classList.add("session-guided-focus");
        window.setTimeout(() => consoleElement?.classList.remove("session-guided-focus"), 1800);
      }, 180);
    }).catch((cause) => setPaymentError(cause instanceof Error ? cause.message : "Unable to load payment session"));
  }, [user]);
  useEffect(() => {
    if (!user || recipient || recipientQuery.trim().length < 2 || isAddress(recipientQuery.trim())) { setResults([]); return; }
    const timeout = window.setTimeout(() => api<{ users: DirectoryUser[] }>(`/api/users?query=${encodeURIComponent(recipientQuery)}`).then(({ users }) => setResults(users)).catch(() => setResults([])), 220);
    return () => window.clearTimeout(timeout);
  }, [recipientQuery, recipient, user]);

  const recipientAddress = recipient?.walletAddress ?? (isAddress(recipientQuery.trim()) ? recipientQuery.trim() : "");
  const requiresSolanaWallet = fundingMethod === "cctp_bridge" && bridgeSourceChain === "Solana_Devnet";
  const displayWalletAddress = walletAddress || user?.walletAddress || "";
  const canReview = fundingMethod === "fiat_bank"
    ? Boolean(recipient?.id && recipientAddress && Number(amount) >= 2 && Number(amount) <= 10)
    : Boolean(displayWalletAddress && chainReady && recipientAddress && Number(amount) > 0 && (!requiresSolanaWallet || solanaAddress));
  const available = fundingMethod === "arc_wallet" ? arcBalance : fundingMethod === "unified_balance" ? unifiedBalance : null;
  const insufficientBalance = available !== null && Number(amount) > Number(available);
  const reviewBlockReason = fundingMethod === "fiat_bank"
    ? recipientQuery.trim() && !recipient?.id ? "Choose a registered OffGrid recipient"
      : amount.trim() && Number(amount) < 2 ? "Circle sandbox bank payments require at least 2.00 USD"
        : amount.trim() && Number(amount) > 10 ? "Sandbox payments are limited to 10.00 USD"
          : ""
    : !displayWalletAddress ? "Connect an EVM wallet first"
      : !chainReady ? "Add Arc Testnet first"
        : requiresSolanaWallet && !solanaAddress ? "Connect a Solana wallet for this source"
          : recipientQuery.trim() && !recipientAddress ? "Enter a valid recipient username or 0x address"
            : amount.trim() && !(Number(amount) > 0) ? "Enter an amount greater than zero"
              : amount.trim() && insufficientBalance ? `Amount exceeds your ${fundingMethod === "arc_wallet" ? "direct wallet" : "confirmed Gateway"} balance`
                : "";
  const paymentIssue = paymentError ? describePaymentIssue(paymentError, bridgeSourceChain, fundingMethod) : null;

  async function refreshGatewayBalance() {
    if (!adapterRef.current || !clientRef.current) throw new Error("Connect an EVM wallet to read Gateway");
    const evmAdapter = adapterRef.current;
    const adapters: CircleAdapter[] = [evmAdapter];
    if (solanaAdapterRef.current) adapters.push(solanaAdapterRef.current);
    let balances;
    let solanaIncluded = Boolean(solanaAdapterRef.current);
    try {
      balances = await clientRef.current.getUnifiedBalance(adapters);
    } catch (error) {
      if (!solanaAdapterRef.current) throw error;
      // A flaky Solana RPC must not hide otherwise valid EVM Gateway balances.
      balances = await clientRef.current.getUnifiedBalance([evmAdapter]);
      solanaIncluded = false;
      setSolanaError(describeSolanaReadIssue(error instanceof Error ? error.message : "Solana Devnet did not respond"));
    }
    const chains = buildGatewayChainBalances(balances, solanaIncluded);
    setUnifiedBalance(balances.totalConfirmedBalance);
    setPendingBalance(balances.totalPendingBalance ?? "0");
    setGatewayChainBalances(chains);
    setGatewayError("");
    setGatewayStale(false);
    return balances;
  }

  async function refreshGatewayBalanceWithRetry() {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await refreshGatewayBalance();
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 500 : 1_200));
      }
    }
    throw lastError;
  }

  async function refreshSolanaWalletBalance() {
    if (!solanaAdapterRef.current || !clientRef.current || !solanaAddress) return null;
    try {
      const balance = await clientRef.current.getSolanaUsdcBalance(solanaAdapterRef.current, solanaAddress);
      setSolanaUsdcBalance(balance);
      setSolanaError("");
      return balance;
    } catch (error) {
      setSolanaUsdcBalance(null);
      setSolanaError(describeSolanaReadIssue(error instanceof Error ? error.message : "Could not read Solana Devnet USDC"));
      return null;
    }
  }

  async function loadBalances(addressOverride?: string) {
    const currentAddress = addressOverride ?? (walletAddress || user?.walletAddress || "");
    if (solanaAdapterRef.current && clientRef.current && solanaAddress) void refreshSolanaWalletBalance();
    if (!currentAddress) return;
    setBalanceError("");
    setGatewayError("");
    const arcResult = await api<{ balance: string }>(`/api/arc/balance?address=${encodeURIComponent(currentAddress)}`)
      .then((result) => ({ status: "fulfilled" as const, value: result }))
      .catch((reason) => ({ status: "rejected" as const, reason }));
    if (arcResult.status === "fulfilled") setArcBalance(arcResult.value.balance);
    else {
      setArcBalance(null);
      setBalanceError(arcResult.reason instanceof Error ? arcResult.reason.message : "Arc RPC could not read USDC");
    }
    if (adapterRef.current && clientRef.current) {
      setGatewayLoading(true);
      const gatewayResult = await refreshGatewayBalanceWithRetry()
        .then((result) => ({ status: "fulfilled" as const, value: result }))
        .catch((reason) => ({ status: "rejected" as const, reason }));
      if (gatewayResult.status === "rejected") {
        setGatewayStale(true);
        setGatewayError("Circle Gateway did not respond after three attempts. Retry the live read.");
      }
      setGatewayLoading(false);
      return;
    }
    setUnifiedBalance(null);
    setPendingBalance(null);
    setGatewayChainBalances(null);
    setGatewayStale(false);
    setGatewayLoading(false);
  }

  async function refreshCctpOperations() {
    try {
      const { operations } = await api<{ operations: CctpOperation[] }>("/api/cctp-operations");
      setCctpOperations(operations);
      const invoiceIds = operations.flatMap((operation) => operation.invoiceId ? [operation.invoiceId] : []);
      const hasNewInvoice = invoiceIds.some((id) => !knownCctpInvoicesRef.current.has(id));
      knownCctpInvoicesRef.current = new Set(invoiceIds);
      if (hasNewInvoice) {
        await api<{ invoices: InvoiceData[] }>("/api/invoices").then(({ invoices }) => setActivity(invoices));
      }
    } catch {
      // A transient status read never interrupts the active payment form.
    }
  }

  async function refreshFiatPayouts() {
    try {
      const { payouts } = await api<{ payouts: FiatPayout[] }>("/api/fiat/payouts");
      setFiatPayouts(payouts);
    } catch {
      // Fiat sandbox refresh is best-effort; a read failure should not break the dashboard.
    }
  }

  async function recoverCctpOperations(silent = false) {
    if (cctpRecovering) return;
    setCctpRecovering(true);
    if (!silent) setCctpRecoveryNote("");
    try {
      const result = await api<{ imported: number; confirmed: number; discovered: number; unavailableChains: CctpSourceChain[]; operations: CctpOperation[] }>("/api/cctp-operations/recover", { method: "POST" });
      setCctpOperations(result.operations);
      const { invoices } = await api<{ invoices: InvoiceData[] }>("/api/invoices");
      setActivity(invoices);
      if (!silent || result.imported > 0) setCctpRecoveryNote(result.imported > 0 ? `Recovered ${result.imported} CCTP ${result.imported === 1 ? "transfer" : "transfers"}; ${result.confirmed} already confirmed on Arc Testnet.` : result.unavailableChains.length ? `The public explorer scan is temporarily unavailable for ${result.unavailableChains.map((chain) => CHAIN_LABELS[chain]).join(", ")}. Stored activity is still shown below.` : `Scan complete. No untracked CCTP burns found in ${result.discovered} recent wallet transactions.`);
    } catch (error) {
      if (!silent) setCctpRecoveryNote(error instanceof Error ? error.message : "CCTP recovery scan failed");
    } finally {
      setCctpRecovering(false);
    }
  }

  async function persistCctpBurn(operationId: string, txHash: string, explorerUrl?: string) {
    const { operation } = await api<{ operation: CctpOperation }>("/api/cctp-operations", { method: "PATCH", body: JSON.stringify({ id: operationId, event: "burn", txHash, explorerUrl }) });
    setCctpOperations((current) => [operation, ...current.filter((entry) => entry.id !== operation.id)]);
  }

  async function refreshGatewayDeposits() {
    try {
      const { deposits } = await api<{ deposits: GatewayDeposit[] }>("/api/gateway-deposits");
      setGatewayDeposits(deposits);
      if (deposits.some((deposit) => deposit.status === "confirmed" && Date.now() - Date.parse(deposit.updatedAt) < 30_000)) {
        void loadBalances();
      }
    } catch {
      // Persisted deposit proof remains visible while Circle or a source RPC is unavailable.
    }
  }

  async function beginWalletConnection() {
    setWalletBusy(true); setWalletError("");
    try {
      const discovered = await discoverBrowserWallets();
      if (!discovered.length) throw new Error("No EVM wallet found. Install MetaMask, Rabby, Coinbase Wallet, or Phantom.");
      setWallets(discovered);
      if (discovered.length === 1) await connectWallet(discovered[0]);
      else setShowWallets(true);
    } catch (error) { setWalletError(error instanceof Error ? error.message : "Wallet connection failed"); }
    finally { setWalletBusy(false); }
  }

  async function connectWallet(wallet: BrowserWallet) {
    setShowWallets(false); setShowWalletMenu(false); setWalletBusy(true); setWalletError("");
    try {
      const address = await requestWalletAccount(wallet.provider);
      const client = new ArcPayrollClient();
      const adapter = await client.connectEvmWallet(wallet.provider);
      unsubscribeProgressRef.current?.();
      unsubscribeProgressRef.current = client.onProgress((payload) => {
        const cctpAction = getCctpActionEvent(payload);
        if (cctpAction?.traceId) {
          const run = cctpRunsRef.current.get(cctpAction.traceId);
          if (run && cctpAction.method === "burn" && cctpAction.state === "success" && cctpAction.txHash && !run.burnCaptured) {
            run.burnCaptured = true;
            const operationId = cctpAction.traceId;
            void persistCctpBurn(operationId, cctpAction.txHash, cctpAction.explorerUrl).then(() => {
              if (activeCctpFormRef.current !== operationId) return;
              activeCctpFormRef.current = null;
              resetPayment();
              setFundingMethod("arc_wallet");
            }).catch((error) => {
              run.burnCaptured = false;
              setPaymentError(error instanceof Error ? error.message : "Could not persist CCTP burn status");
            });
          }
          if (activeCctpFormRef.current !== cctpAction.traceId) return;
        }
        const event = normalizeProtocolEvent(payload);
        if (!event) return;
        setProtocolEvents((current) => {
          const withoutDuplicate = current.filter((item) => item.name.toLowerCase() !== event.name.toLowerCase());
          return [...withoutDuplicate, event].slice(-6);
        });
        if (/approve|burn|attestation|mint/i.test(event.name)) setPaymentPhase("settlement");
      });
      providerRef.current = wallet.provider; adapterRef.current = adapter; clientRef.current = client;
      setWalletAddress(address); setWalletName(wallet.info.name);
      persistWalletProfile(wallet, address);
      setUnifiedBalance(null);
      setPendingBalance(null);
      setGatewayChainBalances(null);
      setGatewayError("");
      setGatewayStale(false);
      const chainId = await wallet.provider.request({ method: "eth_chainId", params: undefined }) as string;
      const onArc = Number.parseInt(chainId, 16) === ARC.chainId;
      setChainReady(true); setWalletOnArc(onArc);
      unsubscribeChainRef.current?.();
      const chainProvider = wallet.provider as ChainAwareProvider;
      const handleChainChanged = (nextChainId: string) => {
        const isArc = Number.parseInt(nextChainId, 16) === ARC.chainId;
        setWalletOnArc(isArc);
        if (isArc) {
          setChainReady(true);
          setWalletError("");
          window.setTimeout(() => loadBalances(address), 0);
        }
      };
      chainProvider.on?.("chainChanged", handleChainChanged);
      unsubscribeChainRef.current = () => chainProvider.removeListener?.("chainChanged", handleChainChanged);
      if (user) {
        const response = await api<{ user: User }>("/api/account/wallet", { method: "PATCH", body: JSON.stringify({ walletAddress: address }) });
        setUser(response.user);
      }
      window.setTimeout(() => void recoverCctpOperations(true), 250);
      window.setTimeout(() => loadBalances(address), 0);
    } catch (error) { setWalletError(error instanceof Error ? error.message : "Wallet connection failed"); }
    finally { setWalletBusy(false); }
  }

  async function disconnectWallet() {
    setWalletBusy(true);
    setWalletError("");
    try {
      await api("/api/auth/logout", { method: "POST" });
      providerRef.current = null;
      adapterRef.current = null;
      clientRef.current = null;
      unsubscribeProgressRef.current?.();
      unsubscribeProgressRef.current = null;
      unsubscribeChainRef.current?.();
      unsubscribeChainRef.current = null;
      setWalletAddress("");
      setWalletName("");
      setChainReady(false);
      setWalletOnArc(false);
      setArcBalance(null);
      setUnifiedBalance(null);
      setPendingBalance(null);
      setGatewayChainBalances(null);
      setBalanceError("");
      setGatewayError("");
      setGatewayStale(false);
      setShowWalletMenu(false);
      try { window.localStorage.removeItem("offgrid-last-evm-wallet"); } catch { /* ignore */ }
      setUser(null);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not disconnect wallet");
    } finally {
      setWalletBusy(false);
    }
  }

  async function switchToArc() {
    if (!providerRef.current) return;
    setWalletBusy(true); setWalletError("");
    try { await ensureArcTestnet(providerRef.current); setChainReady(true); setWalletOnArc(true); window.setTimeout(loadBalances, 0); }
    catch (error) { setWalletError(error instanceof Error ? error.message : "Your wallet could not add Arc Testnet. Try adding it manually from wallet network settings."); }
    finally { setWalletBusy(false); }
  }

  async function ensureClientAndAdapter(): Promise<{ client: ArcPayrollClient; adapter: BrowserViemAdapter }> {
    if (clientRef.current && adapterRef.current) {
      return { client: clientRef.current, adapter: adapterRef.current };
    }
    const client = clientRef.current ?? new ArcPayrollClient();
    clientRef.current = client;

    const discovered = await discoverBrowserWallets();
    if (!discovered.length) throw new Error("No EVM wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.");
    const wallet = discovered[0];
    providerRef.current = wallet.provider;
    const address = await requestWalletAccount(wallet.provider);
    setWalletAddress(address);
    setWalletName(wallet.info.name);
    persistWalletProfile(wallet, address);

    const adapter = await client.connectEvmWallet(wallet.provider);
    adapterRef.current = adapter;
    return { client, adapter };
  }

  async function depositToGateway() {
    setDepositBusy(true); setDepositError("");
    try {
      let adapter: CircleAdapter;
      let client: ArcPayrollClient;
      if (depositChain === "Solana_Devnet") {
        if (!solanaAdapterRef.current) throw new Error("Connect your Solana wallet before depositing from Solana Devnet");
        adapter = solanaAdapterRef.current;
        client = clientRef.current ?? new ArcPayrollClient();
        clientRef.current = client;
      } else {
        const ready = await ensureClientAndAdapter();
        client = ready.client;
        adapter = ready.adapter;
        if (!providerRef.current) throw new Error("Reconnect your EVM wallet before depositing");
        if (depositChain !== "Arc_Testnet") {
          await ensureGatewaySourceChain(providerRef.current, depositChain as EvmSourceChain);
        }
      }
      if (!(Number(depositAmount) > 0)) throw new Error("Enter an amount greater than zero");
      let confirmedBefore = Number(gatewayChainBalances?.find((position) => position.chain === depositChain)?.confirmed ?? 0);
      try {
        const before = await refreshGatewayBalance();
        const positions = buildGatewayChainBalances(before, depositChain !== "Solana_Devnet" || Boolean(solanaAdapterRef.current));
        confirmedBefore = Number(positions.find((position) => position.chain === depositChain)?.confirmed ?? confirmedBefore);
      } catch {
        // A temporary read failure should not block a valid wallet deposit.
      }
      const result = await client.deposit(adapter, depositChain, depositAmount);
      const { deposit } = await api<{ deposit: GatewayDeposit }>("/api/gateway-deposits", {
        method: "POST",
        body: JSON.stringify({
          sourceAddress: depositChain === "Solana_Devnet" ? solanaAddress : (walletAddress || user?.walletAddress),
          sourceChain: depositChain,
          amount: result.amount,
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
          confirmedBefore,
        }),
      });
      setGatewayDeposits((current) => [deposit, ...current.filter((entry) => entry.id !== deposit.id)]);
      setShowFunding(false);
      void loadBalances();
      window.setTimeout(() => void refreshGatewayDeposits(), 2_500);
    } catch (error) { setDepositError(describeGatewayDepositIssue(error instanceof Error ? error.message : "Gateway deposit failed", depositChain)); }
    finally { setDepositBusy(false); }
  }

  async function beginSolanaConnection() {
    setSolanaBusy(true); setSolanaError("");
    try {
      const discovered = discoverSolanaWallets();
      if (!discovered.length) throw new Error("No Solana wallet found. Install Phantom, Solflare, or Backpack.");
      setSolanaWallets(discovered);
      if (discovered.length === 1) await connectSolanaSource(discovered[0]);
      else setShowSolanaWallets(true);
    } catch (error) {
      setSolanaError(error instanceof Error ? error.message : "Solana wallet discovery failed");
    } finally {
      setSolanaBusy(false);
    }
  }

  async function connectSolanaSource(wallet?: SolanaBrowserWallet) {
    setShowSolanaWallets(false);
    setSolanaBusy(true); setSolanaError("");
    try {
      const provider = wallet?.provider ?? getSolanaWalletProvider();
      if (!provider) throw new Error("No Solana wallet found. Install Phantom, Solflare, or Backpack.");
      const address = await requestSolanaAccount(provider);
      const client = clientRef.current ?? new ArcPayrollClient();
      clientRef.current = client;
      const adapter = await client.connectSolanaWallet(provider);
      solanaAdapterRef.current = adapter;
      setSolanaAddress(address);
      setSolanaWalletName(wallet?.name ?? "Solana Wallet");
      if (wallet) persistSolanaProfile(wallet, address);
      try {
        const balance = await client.getSolanaUsdcBalance(adapter, address);
        setSolanaUsdcBalance(balance);
      } catch (error) {
        setSolanaUsdcBalance(null);
        setSolanaError(describeSolanaReadIssue(error instanceof Error ? error.message : "Could not read Solana Devnet USDC"));
      }
      if (adapterRef.current && walletAddress) void loadBalances();
    } catch (error) {
      setSolanaError(error instanceof Error ? error.message : "Solana wallet connection failed");
    } finally {
      setSolanaBusy(false);
    }
  }

  async function createPaymentSession() {
    setSessionBusy(true); setSessionError("");
    try {
      const response = await api<{ session: PaymentSessionView; inviteToken: string }>("/api/payment-sessions", { method: "POST", body: JSON.stringify({ intent: sessionIntent, rail: sessionRail, amount: sessionAmount, memo: sessionMemo }) });
      const link = `${window.location.origin}/session/${response.inviteToken}`;
      setCreatedSessionLink(link);
      setPaymentSessionsList((current) => [response.session, ...current.filter((session) => session.id !== response.session.id)]);
      sessionSnapshotRef.current = new Map([[response.session.id, sessionEventSnapshot(response.session)], ...Array.from(sessionSnapshotRef.current?.entries() ?? [])]);
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : "Unable to create payment session");
    } finally { setSessionBusy(false); }
  }

  async function copyCreatedSession() {
    await navigator.clipboard.writeText(createdSessionLink);
    setSessionLinkCopied(true);
  }

  async function refreshCurrentUser() {
    const response = await api<{ user: User | null }>("/api/auth/me");
    if (response.user) setUser(response.user);
  }

  function selectRecipient(found: DirectoryUser) { setRecipient(found); setRecipientQuery(`@${found.username}`); setResults([]); setPaymentEstimate(null); setGatewayMintRetry(null); setStep("amount"); }

  function useGatewayFallback() {
    setFundingMethod("unified_balance");
    setPaymentError("");
    setPaymentEstimate(null);
    setGatewayMintRetry(null);
    setStep("amount");
    if (Number(unifiedBalance ?? 0) < Number(amount || 0)) {
      setDepositChain(bridgeSourceChain);
      if (amount) setDepositAmount(amount);
      setDepositError("");
      setShowFunding(true);
    }
  }

  function connectedPaymentAdapters() {
    const adapters: CircleAdapter[] = [];
    if (adapterRef.current) adapters.push(adapterRef.current);
    // A connected Solana wallet can remain available while Devnet is rate
    // limited. Do not let a failed Solana read poison an otherwise valid EVM
    // Gateway route; it can be re-enabled after the next successful balance
    // refresh.
    if (solanaAdapterRef.current && solanaAddress && solanaUsdcBalance !== null) adapters.push(solanaAdapterRef.current);
    return adapters;
  }

  async function estimatePayment() {
    setEstimateBusy(true); setPaymentPhase("estimate"); setPaymentError(""); setPaymentEstimate(null); setGatewayMintRetry(null); setProtocolEvents([]);
    try {
      if (fundingMethod === "fiat_bank") {
        if (!recipient?.id) throw new Error("Choose a registered OffGrid recipient");
        if (Number(amount) < 2 || Number(amount) > 10) throw new Error("Circle sandbox payments must be between 2.00 and 10.00 USD");
        const status = await api<{ configured: boolean }>("/api/fiat/status");
        if (!status.configured) throw new Error("Circle sandbox settlement is not configured");
        setPaymentEstimate({ title: "Fiat to Web3 proof route", detail: "Circle records the sandbox wire and deposit before a developer wallet sends testnet USDC to the recipient.", fees: "No real fiat is charged" });
        return;
      }
      if (!recipientAddress || !user) throw new Error("Please select or enter a recipient address");
      const { client, adapter } = await ensureClientAndAdapter();
      if (fundingMethod === "arc_wallet") {
        await client.estimateArcSend(adapter, recipientAddress, amount);
        setPaymentEstimate({ title: "Direct testnet transfer", detail: `${amount} USDC settles directly on Arc Testnet`, fees: "Network gas is paid in USDC" });
      } else if (fundingMethod === "unified_balance") {
        const destinationAdapter = adapter;
        const sourceAdapters = connectedPaymentAdapters();
        if (!sourceAdapters.length) sourceAdapters.push(adapter);
        await client.estimatePayrollToArc(sourceAdapters, recipientAddress, amount, destinationAdapter);
        setPaymentEstimate({ title: "Gateway unified spend", detail: `App Kit automatically allocates confirmed deposits${solanaAddress ? ", including Solana Devnet" : ""}`, fees: "Final destination: Arc Testnet" });
      } else {
        const sourceAdapter = bridgeSourceChain === "Solana_Devnet" ? solanaAdapterRef.current : adapter;
        if (!sourceAdapter) throw new Error("Connect the selected source wallet first");
        const estimate = await client.estimateBridgeToArc(sourceAdapter, bridgeSourceChain, recipientAddress, amount);
        setPaymentEstimate({ title: `${CHAIN_LABELS[bridgeSourceChain]} → Arc Testnet`, detail: "CCTP V2 standard burn with Circle Forwarder completing the Arc mint", fees: bridgeFeeSummary(estimate) });
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "App Kit could not estimate this route");
      setPaymentEstimate(null);
    } finally {
      setEstimateBusy(false);
    }
  }

  async function saveGatewayPaymentResult(result: unknown) {
    const transaction = result as { state?: string; txHash?: string; explorerUrl?: string; error?: { message?: string } };
    if (transaction.state === "error" || !transaction.txHash) throw new Error(transaction.error?.message ?? "App Kit did not return a confirmed Gateway transaction hash");
    setPaymentPhase("receipt");
    const saved = await api<{ invoice: InvoiceData }>("/api/invoices", { method: "POST", body: JSON.stringify({
      recipientUserId: recipient?.id ?? null, recipientAddress, recipientLabel: recipient?.displayName ?? shortAddress(recipientAddress),
      amount, fundingMethod: "unified_balance", txHash: transaction.txHash, memo, paymentSessionToken: activeSessionToken || undefined,
      sourceChain: "Arc_Testnet",
    }) });
    setInvoice(saved.invoice); setGatewayMintRetry(null); setStep("complete"); await loadBalances();
  }

  async function retryGatewayMint() {
    if (!recipientAddress || !user || !gatewayMintRetry) return;
    const { client, adapter } = await ensureClientAndAdapter();
    setGatewayMintBusy(true); setStep("processing"); setPaymentPhase("settlement"); setPaymentError(""); setProtocolEvents([]);
    try {
      const result = await client.retryGatewayMint(adapter, recipientAddress, amount, gatewayMintRetry);
      await saveGatewayPaymentResult(result);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Arc mint retry failed");
      setStep("review");
    } finally {
      setGatewayMintBusy(false);
    }
  }

  async function pay() {
    if (!recipientAddress || !user || !paymentEstimate) return;
    if (fundingMethod === "fiat_bank") {
      setStep("processing"); setPaymentPhase("settlement"); setPaymentError(""); setProtocolEvents([]);
      try {
        if (!recipient?.id) throw new Error("Choose a registered OffGrid recipient");
        const created = await api<{ session: PaymentSessionView; settlementToken: string }>("/api/payment-sessions/direct", { method: "POST", body: JSON.stringify({
          recipientUserId: recipient.id,
          recipientAddress,
          amount,
          memo,
        }) });
        setActiveSession(created.session);
        setActiveSessionToken(created.settlementToken);
        setPaymentSessionsList((current) => [created.session, ...current.filter((entry) => entry.id !== created.session.id)]);
        let settled = created.session;
        for (let attempt = 0; attempt < 90 && settled.status !== "complete"; attempt += 1) {
          const response = await api<{ session: PaymentSessionView }>(`/api/payment-sessions/${encodeURIComponent(created.settlementToken)}/settlement`, { method: "POST", body: "{}" });
          settled = response.session;
          setActiveSession(settled);
          setPaymentSessionsList((current) => current.map((entry) => entry.id === settled.id ? settled : entry));
          setProtocolEvents(fiatProofEvents(settled));
          if (settled.status !== "complete") await new Promise((resolve) => window.setTimeout(resolve, 3_000));
        }
        if (settled.status !== "complete" || !settled.invoiceId) throw new Error("The provider route is still settling. It remains saved in your payment sessions and can continue safely.");
        const saved = await api<{ invoice: InvoiceData }>(`/api/invoices/${settled.invoiceId}`);
        setPaymentPhase("receipt");
        setInvoice(saved.invoice);
        setStep("complete");
        await refreshCurrentUser();
        await loadBalances();
      } catch (error) {
        setPaymentError(error instanceof Error ? error.message : "Fiat to Web3 settlement failed");
        setPaymentEstimate(null);
        setStep("review");
      }
      return;
    }
    const { client, adapter } = await ensureClientAndAdapter();
    setStep("processing"); setPaymentPhase("signature"); setPaymentError(""); setProtocolEvents([]);
    if (fundingMethod === "cctp_bridge") {
      const sourceAdapter = bridgeSourceChain === "Solana_Devnet" ? solanaAdapterRef.current : adapterRef.current;
      if (!sourceAdapter) { setPaymentError("Connect the selected source wallet first"); setStep("review"); return; }
      const operationInput = {
        recipientUserId: recipient?.id ?? null,
        recipientAddress,
        recipientLabel: recipient?.displayName ?? shortAddress(recipientAddress),
        amount,
        sourceChain: bridgeSourceChain,
        memo,
        paymentSessionToken: activeSessionToken || undefined,
      };
      let operation: CctpOperation | null = null;
      let run: { burnCaptured: boolean } | null = null;
      try {
        const created = await api<{ operation: CctpOperation }>("/api/cctp-operations", { method: "POST", body: JSON.stringify(operationInput) });
        operation = created.operation;
        run = { burnCaptured: false };
        cctpRunsRef.current.set(operation.id, run);
        activeCctpFormRef.current = operation.id;
        setCctpOperations((current) => [operation!, ...current.filter((entry) => entry.id !== operation!.id)]);
        let result = await client.bridgeToArc(sourceAdapter, bridgeSourceChain, recipientAddress, amount, operation.id);
        if (result.state === "error") result = await client.retryBridge(result, sourceAdapter);
        if (result.state !== "success") {
          const failed = result.steps.find((item) => item.state === "error");
          throw new Error(failed?.errorMessage ?? "CCTP bridge did not complete");
        }
        const mint = getArcMintStep(result);
        if (!mint?.txHash) throw new Error("Circle Forwarder completed without an Arc mint transaction hash");
        const updated = await api<{ operation: CctpOperation }>("/api/cctp-operations", { method: "PATCH", body: JSON.stringify({
          id: operation.id,
          event: "mint_submitted",
          txHash: mint.txHash,
          bridgeSteps: result.steps.map((item) => ({ name: item.name, txHash: item.txHash, explorerUrl: item.explorerUrl })),
        }) });
        setCctpOperations((current) => [updated.operation, ...current.filter((entry) => entry.id !== updated.operation.id)]);
        if (activeCctpFormRef.current === operation.id) {
          activeCctpFormRef.current = null;
          resetPayment();
          setFundingMethod("arc_wallet");
        }
        await refreshCctpOperations();
        await loadBalances();
      } catch (error) {
        const message = error instanceof Error ? error.message : "CCTP payment failed";
        if (operation && !run?.burnCaptured) {
          await api<{ removed: boolean }>("/api/cctp-operations", { method: "DELETE", body: JSON.stringify({ id: operation.id }) })
            .then(() => setCctpOperations((current) => current.filter((entry) => entry.id !== operation!.id)))
            .catch(async () => {
              // If a burn reached the server between the error and cleanup, the
              // API refuses deletion and we keep polling that real transfer.
              await api<{ operation: CctpOperation }>("/api/cctp-operations", { method: "PATCH", body: JSON.stringify({ id: operation!.id, event: "failed", errorMessage: message }) })
                .then(({ operation: updated }) => setCctpOperations((current) => [updated, ...current.filter((entry) => entry.id !== updated.id)]))
                .catch(() => undefined);
            });
        } else if (operation) {
          await api<{ operation: CctpOperation }>("/api/cctp-operations", { method: "PATCH", body: JSON.stringify({ id: operation.id, event: "failed", errorMessage: message }) })
            .then(({ operation: updated }) => setCctpOperations((current) => [updated, ...current.filter((entry) => entry.id !== updated.id)]))
            .catch(() => undefined);
        }
        if (!run?.burnCaptured && (!operation || activeCctpFormRef.current === operation.id)) {
          activeCctpFormRef.current = null;
          setPaymentError(message);
          setPaymentEstimate(null);
          setStep("review");
        }
      } finally {
        if (operation) cctpRunsRef.current.delete(operation.id);
      }
      return;
    }
    try {
      let txHash = "";
      const result = fundingMethod === "arc_wallet"
        ? await client.sendArcUsdc(adapter, recipientAddress, amount)
        : await client.settlePayrollToArc(connectedPaymentAdapters(), recipientAddress, amount, adapter);
      setPaymentPhase("settlement");
      if (fundingMethod === "unified_balance") {
        await saveGatewayPaymentResult(result);
        return;
      }
      const transaction = result as unknown as { state?: string; txHash?: string; error?: { message?: string } };
      if (transaction.state === "error" || !transaction.txHash) throw new Error(transaction.error?.message ?? "App Kit did not return a confirmed transaction hash");
      txHash = transaction.txHash;
      setPaymentPhase("receipt");
      const saved = await api<{ invoice: InvoiceData }>("/api/invoices", { method: "POST", body: JSON.stringify({
        recipientUserId: recipient?.id ?? null, recipientAddress, recipientLabel: recipient?.displayName ?? shortAddress(recipientAddress),
        amount, fundingMethod, txHash, memo, paymentSessionToken: activeSessionToken || undefined,
        sourceChain: "Arc_Testnet",
      }) });
      setInvoice(saved.invoice); setStep("complete"); await loadBalances();
    } catch (error) {
      const retry = fundingMethod === "unified_balance" ? getGatewayMintRetry(error) : null;
      if (retry) {
        setGatewayMintRetry(retry);
        setPaymentEstimate(null);
        setPaymentError("Gateway accepted the source transfer, but Arc mint confirmation failed. Reconnecting to Arc without submitting the source transfer again…");
        setGatewayMintBusy(true);
        try {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          const recovered = await client.retryGatewayMint(adapter, recipientAddress, amount, retry);
          await saveGatewayPaymentResult(recovered);
        } catch (retryError) {
          setPaymentError(retryError instanceof Error ? `Arc mint still needs recovery: ${retryError.message}` : "Arc mint still needs recovery. Retry the saved mint; the source will not be charged again.");
          setStep("review");
        } finally {
          setGatewayMintBusy(false);
        }
        return;
      }
      setPaymentError(error instanceof Error ? error.message : "Payment failed"); setPaymentEstimate(null); setStep("review");
    }
  }

  async function executeMassPayroll(members: MassTeamMember[], massFunding: MassFunding, onProgress: (completed: number, total: number) => void): Promise<MassRunResult> {
    if (!clientRef.current || !adapterRef.current) throw new Error("Connect an EVM wallet before running payroll");
    const payouts = members.map((member) => ({ recipientAddress: member.address, amount: member.amount }));
    const adapters: CircleAdapter[] = [adapterRef.current];
    if (solanaAdapterRef.current && solanaAddress && solanaUsdcBalance !== null) adapters.push(solanaAdapterRef.current);
    const settlement = massFunding === "arc_wallet"
      ? await clientRef.current.massPayArc(adapterRef.current, payouts)
      : await clientRef.current.massPayUnified(adapters, payouts, onProgress, adapterRef.current);
    if (massFunding === "arc_wallet") onProgress(settlement.txHashes.length, members.length);

    const settledMembers = members.slice(0, settlement.txHashes.length);
    const saved = await Promise.allSettled(settledMembers.map((member, index) => {
      const txHash = settlement.txHashes[index];
      if (!txHash) throw new Error(`Missing transaction proof for ${member.name}`);
      return api<{ invoice: InvoiceData }>("/api/invoices", { method: "POST", body: JSON.stringify({
        recipientUserId: member.userId ?? null,
        recipientAddress: member.address,
        recipientLabel: member.name,
        amount: member.amount,
        fundingMethod: massFunding,
        txHash,
        memo: `Mass payroll · ${members.length} recipients`,
        sourceChain: "Arc_Testnet",
      }) });
    }));
    const receiptsSaved = saved.filter((entry) => entry.status === "fulfilled").length;
    await api<{ invoices: InvoiceData[] }>("/api/invoices").then(({ invoices }) => setActivity(invoices)).catch(() => undefined);
    await loadBalances();
    return { ...settlement, receiptsSaved };
  }

  function resetPayment() { setStep("recipient"); setRecipient(null); setRecipientQuery(""); setAmount(""); setMemo(""); setPaymentError(""); setPaymentEstimate(null); setGatewayMintRetry(null); setProtocolEvents([]); setInvoice(null); setActiveSession(null); setActiveSessionToken(""); window.history.replaceState({}, "", "/"); }

  async function logout() { await api("/api/auth/logout", { method: "POST", body: "{}" }); setUser(null); }

  if (booting) return <main className="boot-screen"><Logo /><LoaderCircle className="spin" /><span>INITIALIZING OFFGRID</span></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  const totalMoney = arcBalance !== null && unifiedBalance !== null
    ? Number(arcBalance) + Number(unifiedBalance)
    : null;

  return (
    <main className="product-shell">
      <header className="product-header">
        <a className="product-brand" href="#top"><Logo /><b>offgrid</b><span>ARC TESTNET</span></a>
        <div className="header-actions">
          {displayWalletAddress && !walletOnArc && <button className="arc-switch-button" onClick={switchToArc} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="spin" size={12} /> : <Network size={12} />} Switch to Arc Testnet</button>}
          
          <a className="faucet-button" href="https://faucet.circle.com/" target="_blank" rel="noreferrer"><Fuel size={15} /> Get Test USDC <ExternalLink size={12} /></a>

          {displayWalletAddress ? (
            <div className={`connected-wallet-shell ${showWalletMenu ? "open" : ""}`} ref={walletMenuRef}>
              <button className="connected-wallet" onClick={() => setShowWalletMenu((current) => !current)} onMouseEnter={() => setShowWalletMenu(true)}>
                <span><Wallet size={14} /></span>
                <b>{shortAddress(displayWalletAddress)}</b>
                <small>{walletName || user.displayName}</small>
                <ChevronDown size={13} />
              </button>
              <div className="connected-wallet-menu">
                <button className="solana-dropdown-row" onClick={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} disabled={solanaBusy}>
                  <ChainLogo chain="Solana_Devnet" size={16}/>
                  <span>{solanaAddress ? `Solana: ${shortAddress(solanaAddress, 4)}` : "Connect Solana Wallet"}</span>
                  {solanaAddress && <small>{solanaUsdcBalance === null ? "" : `${displayMoney(solanaUsdcBalance)} USDC`}</small>}
                </button>
                <div className="menu-divider" />
                <button onClick={() => { setShowWalletMenu(false); void loadBalances(); }}><RefreshCw size={12} /> Refresh Balances</button>
                <button onClick={() => { void disconnectWallet(); }}><LogOut size={12} /> Disconnect Wallet</button>
              </div>
            </div>
          ) : (
            <button className="connect-wallet" onClick={beginWalletConnection} disabled={walletBusy}>
              {walletBusy ? <LoaderCircle className="spin" size={15} /> : <Wallet size={15} />} Connect Wallet
            </button>
          )}

          <button className="user-menu" onClick={() => setShowUserModal(true)} title={`Signed in as @${user.username}`}>
            <span className="user-emblem-sm"><User size={14} /></span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>

      {solanaError && <div className="wallet-error-toast"><ChainLogo chain="Solana_Devnet" size={20}/><span><b>Solana wallet</b><small>{solanaError}</small></span><button onClick={() => setSolanaError("")} aria-label="Dismiss Solana wallet error"><X size={13}/></button></div>}

      <div className="product-grid" id="top">
        <aside className="command-rail">
          <div className="command-rail-inner">
            <div className="rail-user"><span className="user-avatar-glowing rail-user-avatar"><User size={17} /><i className="avatar-ring-glow" /></span><div><b>{user.displayName}</b><small>@{user.username}</small></div><BadgeCheck size={16} /></div>
            <nav><button className={activeView === "transfer" ? "active" : ""} onClick={() => openWorkspaceView("transfer")}><Send size={17} /> Transfer</button><button className={activeView === "history" ? "active" : ""} onClick={() => openWorkspaceView("history")}><Receipt size={17} /> History {displayWalletAddress && <span>{activity.length + fiatPayouts.length + cctpOperations.filter((operation) => !operation.invoiceId && isSubmittedCctpOperation(operation)).length + gatewayDeposits.length}</span>}</button><button className={activeView === "unified" ? "active" : ""} onClick={() => { openWorkspaceView("unified"); void loadBalances(); }}><Network size={17} /> Unified Balance</button><button className={activeView === "mass" ? "active" : ""} onClick={() => openWorkspaceView("mass")}><UserRound size={17} /> Mass Payment</button><button className={activeView === "escrow" ? "active" : ""} onClick={() => openWorkspaceView("escrow")}><Scale size={17} /> Escrow Market</button><button className={activeView === "agents" ? "active" : ""} onClick={() => openWorkspaceView("agents")}><Sparkles size={17} /> Agent Payments <span className="soon-badge">SOON</span></button></nav>
            <button className="logout-button" onClick={() => setShowLogoutConfirm(true)}><LogOut size={15} /> Sign Out</button>
          </div>
        </aside>

        <section className="product-main">
          <NeonMesh opacity={0.22} />
          {activeView === "transfer" ? <div className="transfer-view">
          {displayWalletAddress && <section className="session-launchpad">
            <div className="session-launch-glow" />
            <div className="session-launch-icon"><LockKeyhole size={24} /><i /></div>
            <div className="session-launch-copy"><span><Sparkles size={11} /> START HERE · PRIVATE PAYMENT</span><h2>Open a payment session.</h2><p>Set the direction and amount, share one secure link, then let both sides choose how money moves.</p><div className="session-launch-flow"><span><i>1</i>Set terms</span><b /><span><i>2</i>Share privately</span><b /><span><i>3</i>Settle together</span></div></div>
            <div className="session-launch-column">
              <button className="session-launch-button" onClick={() => { setCreatedSessionLink(""); setSessionError(""); setSessionLinkCopied(false); setShowSessionCreator(true); }}><span><Plus size={18} /></span><div><small>NEW SECURE FLOW</small><b>Create Payment Session</b></div><ArrowRight size={18} /></button>
              <button type="button" className="live-sessions-text-link" onClick={() => { setSessionError(""); setShowLiveSessionsModal(true); void refreshPaymentSessions(); }}>
                <Radio size={12} className="spin-slow" />
                <span>View Active Payment Sessions</span>
                <ArrowRight size={12} />
              </button>
            </div>
          </section>}
          <div className="workspace-head"><span><Radio size={11} /> LIVE COMMAND CENTER</span><h1>Move money.<br /><em>Not complexity.</em></h1><p>Agree on both rails, then execute real settlement.</p></div>

          {!displayWalletAddress ? (
            <section className="onboarding-card">
              <div className="onboarding-art"><div className="wallet-core"><Wallet size={30} /></div><i /><i /><i /><span>01</span><span>02</span><span>03</span></div>
              <div><span className="section-tag">STEP 01 · WALLET ACCESS</span><h2>Connect the wallets you control.</h2><p>Your EVM wallet signs testnet transactions. Add a Solana wallet whenever you want to deposit, bridge, or spend Solana Devnet USDC through Circle.</p><div className="onboarding-wallet-actions"><button className="neon-button" onClick={beginWalletConnection} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />} Connect EVM wallet <ArrowRight size={16} /></button><button className="solana-onboarding-button" onClick={() => void beginSolanaConnection()} disabled={solanaBusy}><ChainLogo chain="Solana_Devnet" size={20}/>{solanaBusy ? "Opening wallet…" : solanaAddress ? `${shortAddress(solanaAddress, 5)} connected` : "Connect Solana"}</button></div>{walletError && <p className="inline-error"><CircleAlert size={13} />{walletError}</p>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}</div>
            </section>
          ) : (
            <>
              <section className="real-balances">
                <div className="balance-intro"><span className="section-tag">REAL TESTNET BALANCES</span><h2>Your money, live.</h2><p>Read directly from connected networks and Circle Gateway. No demo numbers.</p></div>
                <article className="real-balance primary"><div><span className="balance-icon"><ChainLogo chain="Arc_Testnet" size={25}/></span><small>ARC TESTNET WALLET</small><button onClick={() => loadBalances()} aria-label="Refresh balances"><RefreshCw size={13} /></button></div><b>{arcBalance === null ? "-" : displayMoney(arcBalance)} <em>USDC</em></b><p className={balanceError ? "balance-read-error" : ""} title={balanceError || undefined}>{balanceError ? "Testnet RPC unavailable · retry" : shortAddress(displayWalletAddress)}</p></article>
                <article className="real-balance"><div><span className="balance-icon gateway">{gatewayLoading ? <LoaderCircle className="spin" size={16}/> : <Network size={16} />}</span><small>UNIFIED BALANCE</small><button onClick={() => loadBalances()} aria-label="Refresh balances"><RefreshCw className={gatewayLoading ? "spin" : ""} size={13} /></button></div><b>{unifiedBalance === null ? "0.00" : displayMoney(unifiedBalance)} <em>USDC</em></b><p className={gatewayError ? "balance-read-error" : ""} title={gatewayError || undefined}>{gatewayLoading ? "Reading live Circle Gateway balance" : gatewayError || (unifiedBalance === null ? "Connect wallet to load Gateway" : pendingBalance && Number(pendingBalance) > 0 ? `${displayMoney(pendingBalance)} USDC pending` : "Circle Gateway · confirmed")}</p><button className="deposit-link" onClick={() => { setDepositError(""); setShowFunding(true); }}><Plus size={12} /> Deposit</button></article>
                <article className="real-balance total-money"><div><span className="balance-icon total-money"><Wallet size={16} /></span><small>TOTAL MONEY</small><button onClick={() => { void loadBalances(); }} aria-label="Refresh total money"><RefreshCw size={13} /></button></div><b>{totalMoney === null ? "-" : displayMoney(totalMoney)} <em>USDC</em></b><p>{totalMoney === null ? "Reading confirmed balances" : "Direct Arc Testnet wallet plus confirmed unified balance"}</p></article>
              </section>

              <section className="pay-console" id="payment-console">
                <div className="console-head"><div><span className="section-tag">NEW PAYMENT</span><h2>Send with zero ambiguity.</h2></div><div className="stepper">{["recipient","amount","review"].map((item,index) => <span key={item} className={step === item || (step === "processing" && index === 2) ? "active" : ""}><i>{index + 1}</i>{item}</span>)}</div></div>
                {activeSession && <div className="locked-session-banner"><LockKeyhole size={15} /><div><small>LOCKED PAYMENT SESSION · {activeSession.id.slice(0, 8).toUpperCase()}</small><b>{activeSession.creator?.displayName} and {activeSession.counterparty?.displayName} agreed to {activeSession.amount} USDC</b></div><ShieldCheck size={16} /></div>}

                <div className="console-body">
                  <div className="payment-form">
                    <label className="field-label"><span>01</span> WHO ARE YOU PAYING?</label>
                    <div className={`recipient-input ${recipientAddress ? "valid" : ""}`}><Search size={18} /><input value={recipientQuery} readOnly={Boolean(activeSession)} onChange={(event) => { setRecipientQuery(event.target.value); setRecipient(null); setPaymentEstimate(null); setGatewayMintRetry(null); setStep("recipient"); }} placeholder="Search @username or paste 0x address" />{recipientAddress && <CircleCheck size={18} />}</div>
                    {results.length > 0 && <div className="recipient-results">{results.map((found) => <button key={found.id} onClick={() => selectRecipient(found)}><span>{found.displayName.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><b>{found.displayName}</b><small>@{found.username}</small></div><em>{shortAddress(found.walletAddress)}</em><ArrowRight size={14} /></button>)}</div>}
                    {recipientAddress && <div className="selected-recipient"><span>{recipient?.displayName.split(" ").map((part) => part[0]).slice(0,2).join("") ?? "0x"}</span><div><small>RECIPIENT RESOLVED</small><b>{recipient?.displayName ?? "External wallet"}</b><em>{shortAddress(recipientAddress)}</em></div><Check size={15} /></div>}

                    <label className="field-label"><span>02</span> HOW MUCH?</label>
                    <div className="amount-field"><i>$</i><input value={amount} readOnly={Boolean(activeSession)} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); setPaymentEstimate(null); setGatewayMintRetry(null); setStep("amount"); }} placeholder="0.00" inputMode="decimal" /><b>USDC</b></div>
                    <div className="available-line"><span>{fundingMethod === "cctp_bridge" ? <><b>Source-chain USDC</b> · validated by App Kit</> : fundingMethod === "fiat_bank" ? <><b>Circle sandbox route</b> · 2.00 to 10.00 USD · no real fiat charged</> : available === null ? <><b>Balance not loaded</b> · App Kit will validate</> : <>Available: <b>{displayMoney(available)} USDC</b></>}</span>{fundingMethod !== "cctp_bridge" && fundingMethod !== "fiat_bank" && <button onClick={() => { if (available) setAmount(available); setGatewayMintRetry(null); setPaymentEstimate(null); }}>MAX</button>}</div>

                    <label className="field-label"><span>03</span> FUND FROM</label>
                    <div className="funding-options">
                      <button className={fundingMethod === "arc_wallet" ? "active" : ""} onClick={() => { setFundingMethod("arc_wallet"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Wallet size={16} /><span><b>Direct Wallet</b><small>App Kit send</small></span>{fundingMethod === "arc_wallet" && <Check size={14} />}</button>
                      <button className={fundingMethod === "unified_balance" ? "active" : ""} onClick={() => { setFundingMethod("unified_balance"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Network size={16} /><span><b>Unified Balance</b><small>Gateway auto-allocation</small></span>{fundingMethod === "unified_balance" && <Check size={14} />}</button>
                      <button className={fundingMethod === "cctp_bridge" ? "active" : ""} onClick={() => { setFundingMethod("cctp_bridge"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Blocks size={16} /><span><b>CCTP Bridge</b><small>Cross-chain to Arc Testnet</small></span>{fundingMethod === "cctp_bridge" && <Check size={14} />}</button>
                      <button className={fundingMethod === "fiat_bank" ? "active" : ""} onClick={() => { setFundingMethod("fiat_bank"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Banknote size={16} /><span><b>Fiat to Web3</b><small>Circle sandbox + testnet USDC</small></span>{fundingMethod === "fiat_bank" && <Check size={14} />}</button>
                    </div>
                    <RevealPanel show={fundingMethod === "cctp_bridge"}><div className="cctp-config"><div className="cctp-source-card"><span className="cctp-card-label">SOURCE CHAIN</span><ChainSelect className="cctp-chain-select" value={bridgeSourceChain} chains={CCTP_SOURCE_CHAINS} eyebrow="PAY FROM" onChange={(chain) => { setBridgeSourceChain(chain as CctpSourceChain); setPaymentEstimate(null); }} /><p>USDC balance and native source-chain gas required.</p></div><div className="cctp-route-card"><div className="cctp-protocol-head"><span><Blocks size={15} /></span><div><small>BRIDGE PROTOCOL</small><b>CCTP V2</b></div><em>FORWARDED</em></div><div className="cctp-mini-route"><ChainName chain={bridgeSourceChain} size={15}/><i><ArrowRight size={12} /></i><ChainName chain="Arc_Testnet" size={15}/></div><p><Check size={11} /> Circle Forwarder <i /> fee shown in estimate</p></div></div>{bridgeSourceChain === "Solana_Devnet" && <div className={`solana-source ${solanaAddress ? "connected" : ""}`}><span><ChainLogo chain="Solana_Devnet" size={22}/></span><div><b>{solanaAddress ? `${solanaWalletName} connected` : "Solana signer required"}</b><small>{solanaAddress ? `${shortAddress(solanaAddress, 6)} · ${solanaUsdcBalance === null ? "balance unavailable" : `${displayMoney(solanaUsdcBalance)} USDC`}` : "Phantom · Solflare · Backpack"}</small></div>{solanaAddress ? <Check size={15} /> : <button onClick={() => void beginSolanaConnection()} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={13} /> : "Connect"}</button>}</div>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}</RevealPanel>

                    <label className="field-label optional"><span>04</span> MEMO <em>OPTIONAL</em></label>
                    <input className="memo-input" value={memo} readOnly={Boolean(activeSession)} onChange={(event) => setMemo(event.target.value)} maxLength={180} placeholder="What is this payment for?" />
                  </div>

                  <aside className="route-panel">
                    <span className="section-tag">LIVE ROUTE</span><h3>Settlement path</h3>
                    <div className="route-node ready"><span className={fundingMethod === "cctp_bridge" || fundingMethod === "arc_wallet" || fundingMethod === "fiat_bank" ? "chain-logo-only" : ""}>{fundingMethod === "cctp_bridge" ? <ChainLogo chain={bridgeSourceChain} size={24}/> : fundingMethod === "arc_wallet" ? <ChainLogo chain="Arc_Testnet" size={24}/> : fundingMethod === "fiat_bank" ? <Banknote size={16} /> : <Network size={16} />}</span><div><small>SOURCE</small><b>{fundingMethod === "arc_wallet" ? "Direct wallet" : fundingMethod === "unified_balance" ? "Gateway balance" : fundingMethod === "fiat_bank" ? "Sandbox bank payment" : CHAIN_LABELS[bridgeSourceChain]}</b><em>{fundingMethod === "cctp_bridge" ? "Connected source signer" : fundingMethod === "fiat_bank" ? "Circle Mint test wire" : available === null ? "Balance loading" : `${displayMoney(available)} USDC available`}</em></div><Check size={14} /></div>
                    <i className="route-line"><b /></i>
                    <div className="route-node arc"><span>{fundingMethod === "cctp_bridge" ? <Blocks size={16} /> : fundingMethod === "fiat_bank" ? <Banknote size={16} /> : <ChainLogo chain="Arc_Testnet" size={24}/>}</span><div><small>SETTLEMENT</small><b>{fundingMethod === "cctp_bridge" ? "Circle CCTP V2" : fundingMethod === "fiat_bank" ? "Provider verified route" : "Arc Testnet"}</b><em>{fundingMethod === "cctp_bridge" ? "Burn · attest · Forwarder mint" : fundingMethod === "fiat_bank" ? "Wire · deposit · wallet · receipt" : "Network confirmation"}</em></div><Zap size={14} /></div>
                    <i className="route-line"><b /></i>
                    <div className={`route-node ${recipientAddress ? "ready" : "waiting"}`}><span><UserRound size={16} /></span><div><small>DESTINATION</small><b>{recipient?.displayName ?? (recipientAddress ? "External wallet" : "Waiting for recipient")}</b><em>{recipientAddress ? shortAddress(recipientAddress) : "Enter a username or address"}</em></div>{recipientAddress ? <Check size={14} /> : <Radio size={14} />}</div>
                    <dl><div><dt>Asset</dt><dd>{fundingMethod === "fiat_bank" ? "USD → USDC" : "USDC"}</dd></div><div><dt>Protocol</dt><dd>{fundingMethod === "cctp_bridge" ? "CCTP V2" : fundingMethod === "unified_balance" ? "Gateway" : fundingMethod === "fiat_bank" ? "Circle sandbox" : "App Kit send"}</dd></div><div><dt>Destination</dt><dd>{fundingMethod === "fiat_bank" ? "Receiver Arc wallet" : "Arc Testnet"}</dd></div><div><dt>Proof</dt><dd>{fundingMethod === "fiat_bank" ? "Provider + onchain" : "Your wallet"}</dd></div></dl>
                    {paymentIssue && <div className="payment-issue" role="alert"><span><CircleAlert size={15} /></span><div><b>{paymentIssue.title}</b><p>{paymentIssue.detail}</p></div><div className="payment-issue-actions">{fundingMethod === "cctp_bridge" && <button type="button" onClick={useGatewayFallback}><Network size={12} /> Use Gateway</button>}{paymentIssue.retryable && step === "review" && (gatewayMintRetry ? <button type="button" disabled={gatewayMintBusy} onClick={() => void retryGatewayMint()}><RefreshCw className={gatewayMintBusy ? "spin" : ""} size={12} /> {gatewayMintBusy ? "Recovering Arc mint…" : "Retry Arc mint"}</button> : <button type="button" disabled={estimateBusy} onClick={() => { setPaymentError(""); setPaymentEstimate(null); void estimatePayment(); }}><RefreshCw className={estimateBusy ? "spin" : ""} size={12} /> {fundingMethod === "cctp_bridge" ? "Retry CCTP" : fundingMethod === "unified_balance" ? "Retry Gateway" : "Retry route"}</button>)}</div></div>}
                    {step === "review" ? <>
                      {paymentEstimate && <div className="route-estimate"><span><CircleCheck size={14} /></span><div><b>{paymentEstimate.title}</b><small>{paymentEstimate.detail}</small><em>{paymentEstimate.fees}</em></div></div>}
                      <button className={`neon-button pay-now ${estimateBusy || gatewayMintBusy ? "is-loading" : ""}`} onClick={gatewayMintRetry ? retryGatewayMint : paymentEstimate ? pay : estimatePayment} disabled={estimateBusy || gatewayMintBusy}><span className="pay-now-leading">{estimateBusy || gatewayMintBusy ? <LoaderCircle className="spin" size={17} /> : gatewayMintRetry ? <RefreshCw size={17} /> : paymentEstimate ? <Zap size={17} /> : <Network size={17} />}</span><span className="pay-now-label">{estimateBusy ? fundingMethod === "fiat_bank" ? "Checking provider route…" : "Checking live route…" : gatewayMintBusy ? "Recovering Arc mint…" : gatewayMintRetry ? "Retry Arc mint" : paymentEstimate ? fundingMethod === "fiat_bank" ? "Start verified settlement" : "Confirm in wallet" : "Get live estimate"}</span><ArrowRight size={16} /></button>
                    </> : step === "processing" ? <><div className="protocol-progress">{(fundingMethod === "fiat_bank" ? [["estimate","Route check"],["settlement","Provider proofs"],["receipt","Onchain receipt"]] : [["estimate","Live estimate"],["signature","Wallet signature"],["settlement",fundingMethod === "cctp_bridge" ? "CCTP lifecycle" : "Network confirmation"],["receipt","Create receipt"]]).map(([phase,label], index, phases) => { const current = phases.findIndex(([name]) => name === paymentPhase); return <span key={phase} className={index <= current ? "active" : ""}><i>{index < current ? <Check size={9} /> : index + 1}</i>{label}</span>; })}</div>{protocolEvents.length > 0 && <div className="protocol-stream">{protocolEvents.map((event) => <span className={event.state} key={event.name}><i />{event.name}<b>{event.state}</b></span>)}</div>}<button className="neon-button pay-now is-loading" disabled><span className="pay-now-leading"><LoaderCircle className="spin" size={17} /></span><span className="pay-now-label">{paymentPhase === "estimate" ? fundingMethod === "fiat_bank" ? "Checking provider route…" : "Estimating with App Kit…" : paymentPhase === "signature" ? "Confirm in your wallet…" : paymentPhase === "settlement" ? fundingMethod === "fiat_bank" ? "Verifying Circle and onchain proofs…" : fundingMethod === "cctp_bridge" ? "Burning, attesting & minting…" : "Waiting for confirmation…" : "Creating verified receipt…"}</span><span className="pay-now-end" /></button></> : <><button className="neon-button pay-now" disabled={!canReview || insufficientBalance} onClick={() => { setPaymentEstimate(null); setPaymentError(""); setStep("review"); }}><span className="pay-now-leading"><Send size={17} /></span><span className="pay-now-label">{fundingMethod === "fiat_bank" ? "Review Fiat to Web3" : "Review Payment"}</span><ArrowRight size={16} /></button>{reviewBlockReason && <p className="review-blocker"><CircleAlert size={11} /> {reviewBlockReason}</p>}{available === null && canReview && fundingMethod !== "fiat_bank" && <p className="review-warning"><Radio size={11} /> {fundingMethod === "cctp_bridge" ? "App Kit validates source USDC and gas before CCTP execution." : "Balance unavailable in UI; App Kit will check it during estimation."}</p>}</>}
                    <p className="self-custody"><ShieldCheck size={12} /> OffGrid never holds your keys or signs for you.</p>
                    <button className="view-all-activity" onClick={() => openWorkspaceView("history")}>View all activities <ArrowRight size={12} /></button>
                  </aside>
                </div>
              </section>
            </>
          )}
          </div> : activeView === "history" ? walletAddress ? <HistoryView invoices={activity} paymentSessions={paymentSessionsList} deposits={gatewayDeposits} walletAddress={walletAddress} viewer={user} cctpOperations={cctpOperations} fiatPayouts={fiatPayouts} recovering={cctpRecovering} recoveryNote={cctpRecoveryNote} onRecover={() => void recoverCctpOperations()} onRefreshCctp={() => void refreshCctpOperations()} onRefreshGateway={() => void refreshGatewayDeposits()} onRefreshFiat={() => void refreshFiatPayouts()} onSelectEntry={setSelectedProofEntry} /> : <div className="unified-empty"><Receipt size={30} /><h2>Connect a wallet to view history.</h2><p>Transaction activity and receipts stay hidden until your wallet is connected.</p><button className="neon-button" onClick={beginWalletConnection}><Wallet size={15} /> Connect Wallet</button></div> : activeView === "unified" ? <UnifiedBalanceView walletAddress={walletAddress} walletOnArc={walletOnArc} arcBalance={arcBalance} unifiedBalance={unifiedBalance} pendingBalance={pendingBalance} chainBalances={gatewayChainBalances} gatewayError={gatewayError} gatewayStale={gatewayStale} gatewayLoading={gatewayLoading} solanaAddress={solanaAddress} solanaWalletName={solanaWalletName} solanaUsdcBalance={solanaUsdcBalance} solanaBusy={solanaBusy} onRefresh={() => loadBalances()} onDeposit={() => { setDepositError(""); setShowFunding(true); }} onConnect={beginWalletConnection} onConnectSolana={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} /> : activeView === "mass" ? <MassPaymentView walletAddress={walletAddress} directBalance={arcBalance} unifiedBalance={unifiedBalance} onConnect={beginWalletConnection} onExecute={executeMassPayroll} /> : activeView === "escrow" ? <EscrowView walletAddress={displayWalletAddress} arcBalance={arcBalance} onConnect={beginWalletConnection} onRefresh={() => loadBalances()} /> : <section className="agent-soon-view"><div className="agent-orbit"><Sparkles size={27} /><i /><i /><i /></div><span className="section-tag">AUTONOMOUS SETTLEMENT · SOON</span><h1>Agent Payments</h1><p>Policy-controlled wallets, programmable limits, approvals, and auditable payments initiated by trusted agents.</p><div className="agent-soon-grid"><span><ShieldCheck size={16} /><b>Policy engine</b><small>Limits, allowlists, and human approval gates</small></span><span><Network size={16} /><b>Any-to-any rails</b><small>Circle Gateway, CCTP, and fiat routing</small></span><span><Receipt size={16} /><b>Agent audit trail</b><small>Intent, reasoning reference, and transaction proof</small></span></div><em>IN DEVELOPMENT</em></section>}
        </section>
      </div>

      {selectedProofEntry && (
        <div className="overlay">
          <article className="history-proof-modal">
            <button className="modal-x" onClick={() => setSelectedProofEntry(null)}><X size={18} /></button>
            <div className="history-proof-head">
              <span className="section-tag">TRANSFER PROOF</span>
              <div className="history-proof-actions">
                {selectedProofEntry.kind === "fiat" && <button className="history-proof-refresh" onClick={() => { void refreshFiatPayouts(); }}><RefreshCw size={12} /> Refresh Circle status</button>}
                {selectedProofEntry.receiptUrl ? <a className="ledger-proof-link" href={selectedProofEntry.receiptUrl}><Receipt size={12} /> Open receipt</a> : selectedProofEntry.explorerUrl ? <a className="ledger-proof-link" href={selectedProofEntry.explorerUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open explorer</a> : null}
              </div>
            </div>
            <h2>{selectedProofEntry.activity}</h2>
            <p>{selectedProofEntry.kind === "fiat" ? "This view shows the payout request, Circle payout ID, and synced verification status. Use it to confirm the sandbox payout completed." : selectedProofEntry.kind === "cctp" ? "This view shows the source burn, Arc mint, and receipt trail for the bridge transfer." : selectedProofEntry.kind === "deposit" ? "This view shows the source transaction that funded Gateway and the indexing step behind the unified balance." : "This view shows the transaction hash and receipt trail behind the transfer."}</p>
            <div className="history-proof-summary">
              <span><small>STATUS</small><b className={selectedProofEntry.status}>{selectedProofEntry.status}</b></span>
              <span><small>AMOUNT</small><b>{displayMoney(selectedProofEntry.amount)} USDC</b></span>
              <span><small>RAIL</small><b>{selectedProofEntry.rail}</b></span>
            </div>
            <div className="history-proof-steps">
              {proofSteps(selectedProofEntry).map((step, index) => (
                <section key={`${step.label}-${index}`} className={`history-proof-step ${step.tone}`}>
                  <span>{index + 1}</span>
                  <div><b>{step.label}</b><p>{step.detail}</p>{step.txHash && <code>{step.txHash}</code>}</div>
                  {step.explorerUrl && <a href={step.explorerUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} /></a>}
                </section>
              ))}
            </div>
          </article>
        </div>
      )}

      {showUserModal && (
        <div className="overlay">
          <div className="user-control-modal">
            <button className="modal-x" onClick={() => setShowUserModal(false)}><X size={18} /></button>

            <div className="user-profile-header">
              <div className="user-avatar-glowing">
                <User size={22} />
                <i className="avatar-ring-glow" />
              </div>
              <div className="user-profile-info">
                <div className="user-name-line">
                  <h3>{user.displayName}</h3>
                  <BadgeCheck size={16} className="user-verified-icon" />
                </div>
                <p>@{user.username} · <span className="user-id-tag">ID: {user.id.slice(0, 8)}</span></p>
              </div>
            </div>

            <div className="user-modal-stats">
              <div className="modal-stat-chip primary">
                <small><ChainLogo chain="Arc_Testnet" size={14}/> ARC TESTNET WALLET</small>
                <b>{arcBalance === null ? "-" : displayMoney(arcBalance)} <em>USDC</em></b>
              </div>
              <div className="modal-stat-chip">
                <small><Network size={13}/> UNIFIED</small>
                <b>{unifiedBalance === null ? "Not loaded" : displayMoney(unifiedBalance)} {unifiedBalance !== null && <em>USDC</em>}</b>
              </div>
            </div>

            <div className="user-signers-section">
              <span className="section-tag">CONNECTED SIGNERS</span>

              <div className={`signer-row ${displayWalletAddress ? "connected" : "unlinked"}`}>
                <div className="signer-info">
                  <div className="signer-icon-box"><Wallet size={18} /></div>
                  <div>
                    <b>{walletName || "Primary EVM Wallet"}</b>
                    <small>{displayWalletAddress ? shortAddress(displayWalletAddress, 6) : "No EVM wallet connected"}</small>
                  </div>
                </div>
                {displayWalletAddress ? (
                  <button className="signer-action-btn disconnect" onClick={() => { setShowUserModal(false); void disconnectWallet(); }}>
                    <LogOut size={12} /> Disconnect
                  </button>
                ) : (
                  <button className="signer-action-btn connect" onClick={() => { setShowUserModal(false); void beginWalletConnection(); }}>
                    <Wallet size={12} /> Connect
                  </button>
                )}
              </div>

              <div className={`signer-row ${solanaAddress ? "connected" : "unlinked"}`}>
                <div className="signer-info">
                  <div className="signer-icon-box solana"><ChainLogo chain="Solana_Devnet" size={20}/></div>
                  <div>
                    <b>{solanaAddress ? solanaWalletName : "Solana Devnet Signer"}</b>
                    <small>{solanaAddress ? `${shortAddress(solanaAddress, 6)} ${solanaUsdcBalance !== null ? `· ${displayMoney(solanaUsdcBalance)} USDC` : ""}` : "Phantom · Solflare · Backpack"}</small>
                  </div>
                </div>
                {solanaAddress ? (
                  <button className="signer-action-btn disconnect" onClick={disconnectSolanaWallet}>
                    <LogOut size={12} /> Disconnect
                  </button>
                ) : (
                  <button className="signer-action-btn connect" onClick={() => { setShowUserModal(false); void beginSolanaConnection(); }} disabled={solanaBusy}>
                    <Wallet size={12} /> {solanaBusy ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>

            <div className="user-control-actions">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0", padding: "10px 12px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px" }}>
                <span style={{ font: "11px var(--mono)", color: "var(--muted)", fontWeight: 600 }}>INTERFACE THEME</span>
                <ThemeToggle />
              </div>

              <button className="user-logout-btn" onClick={() => { setShowUserModal(false); setShowLogoutConfirm(true); }}>
                <LogOut size={14} /> Sign Out Of Account
              </button>

              <div className="user-modal-version-footer" style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ font: "9px var(--mono)", color: "var(--muted)", letterSpacing: ".06em" }}>OFFGRID PROTOCOL RELEASE</span>
                <span style={{ font: "10px var(--mono)", color: "var(--acid)", fontWeight: 700 }}>OFFGRID v0.3.0 · TESTNET</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWallets && <div className="overlay"><article className="wallet-picker"><button className="modal-x" onClick={() => setShowWallets(false)}><X size={18} /></button><span className="section-tag">SELECT SIGNER</span><h2>Choose your wallet</h2><p>OffGrid found these EIP-6963 providers in your browser.</p>{wallets.map((wallet) => <button className="wallet-choice" key={wallet.info.uuid} onClick={() => connectWallet(wallet)}>{wallet.info.icon ? <img src={wallet.info.icon} alt="" /> : <Wallet size={21} />}<span><b>{wallet.info.name}</b><small>{wallet.info.rdns}</small></span><ArrowRight size={16} /></button>)}</article></div>}

      {showSolanaWallets && <div className="overlay modal-layer-top"><article className="wallet-picker solana-wallet-picker"><button className="modal-x" onClick={() => setShowSolanaWallets(false)}><X size={18} /></button><span className="section-tag">SOLANA DEVNET SIGNER</span><h2>Choose your Solana wallet</h2><p>This signer can deposit USDC into Circle Gateway, fund unified payments, and bridge to Arc Testnet through CCTP.</p>{solanaWallets.map((wallet) => <button className="wallet-choice" key={wallet.id} onClick={() => void connectSolanaSource(wallet)}><ChainLogo chain="Solana_Devnet" size={27}/><span><b>{wallet.name}</b><small>SOLANA DEVNET · SELF-CUSTODY</small></span><ArrowRight size={16} /></button>)}</article></div>}

      {showLogoutConfirm && <div className="overlay modal-layer-top"><article className="logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title"><button className="modal-x" onClick={() => setShowLogoutConfirm(false)} aria-label="Close sign out confirmation"><X size={18}/></button><span className="logout-confirm-icon"><LogOut size={20}/></span><span className="section-tag">ACCOUNT SESSION</span><h2 id="logout-confirm-title">Sign out of OffGrid?</h2><p>Your account session will end on this device. Your wallets remain self-custodied and will not be disconnected from their browser extensions.</p><div className="logout-confirm-actions"><button type="button" className="quiet-confirm-button" onClick={() => setShowLogoutConfirm(false)}>Stay Signed In</button><button type="button" className="danger-confirm-button" onClick={() => { setShowLogoutConfirm(false); void logout(); }}><LogOut size={15}/> Sign Out</button></div></article></div>}

      {showSessionCreator && <div className="overlay"><article className="session-create-modal"><button className="modal-x" onClick={() => setShowSessionCreator(false)}><X size={18} /></button><span className="section-tag">PRIVATE PAYMENT SESSION</span>{createdSessionLink ? <><h2>Your payment window is live.</h2><p>Send this capability link to exactly one person. The first authenticated account to accept becomes the counterparty.</p><div className="created-session-link"><LockKeyhole size={15} /><span>{createdSessionLink}</span></div><button className="neon-button" onClick={copyCreatedSession}><Copy size={15} />{sessionLinkCopied ? "Link copied" : "Copy secure link"}</button><a className="open-session-link" href={createdSessionLink}>Open payment window <ExternalLink size={12} /></a></> : <><h2>Who moves the money?</h2><p>Set immutable starting terms. The other participant chooses their own rail after opening the link.</p><label>Your role<div className="intent-options"><button className={sessionIntent === "pay" ? "active" : ""} onClick={() => setSessionIntent("pay")}><ArrowUpRight size={15} /><span><b>I want to pay</b><small>The invitee receives</small></span>{sessionIntent === "pay" && <Check size={14} />}</button><button className={sessionIntent === "receive" ? "active" : ""} onClick={() => setSessionIntent("receive")}><ArrowDownToLine size={15} /><span><b>I want to receive</b><small>The invitee pays</small></span>{sessionIntent === "receive" && <Check size={14} />}</button></div></label><label>Your preferred rail<div className="intent-options"><button className={sessionRail === "web3_usdc" ? "active" : ""} onClick={() => setSessionRail("web3_usdc")}><Wallet size={15} /><span><b>Web3 USDC</b><small>Direct · Gateway · CCTP</small></span>{sessionRail === "web3_usdc" && <Check size={14} />}</button><button className={sessionRail === "fiat_bank" ? "active" : ""} onClick={() => setSessionRail("fiat_bank")}><Banknote size={15} /><span><b>Bank / fiat</b><small>Sandbox provider stages</small></span>{sessionRail === "fiat_bank" && <Check size={14} />}</button></div></label>{sessionRail === "fiat_bank" && <div className="session-rail-advisory"><CircleAlert size={14} /><p><b>Provider-orchestrated rail</b><span>A session stays pending until Circle records every deposit, transfer, or payout stage. Sandbox bank funding requires at least 2.00 USD.</span></p></div>}<label>Amount<div className="fund-amount"><input value={sessionAmount} onChange={(event) => setSessionAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /><span>USDC / USD</span></div></label>{sessionIntent === "pay" && sessionRail === "fiat_bank" && Number(sessionAmount) > 0 && Number(sessionAmount) < 2 && <p className="inline-error"><CircleAlert size={13} />Circle Mint sandbox bank payments require at least 2.00 USD</p>}<label>Memo <em>OPTIONAL</em><input className="session-memo-input" value={sessionMemo} onChange={(event) => setSessionMemo(event.target.value)} maxLength={180} placeholder="August payroll, design retainer…" /></label>{sessionError && <p className="inline-error"><CircleAlert size={13} />{sessionError}</p>}<button className="neon-button" onClick={createPaymentSession} disabled={sessionBusy || (sessionIntent === "pay" && sessionRail === "fiat_bank" && Number(sessionAmount) > 0 && Number(sessionAmount) < 2)}>{sessionBusy ? <LoaderCircle className="spin" size={15} /> : <LockKeyhole size={15} />} Create immutable session</button></>}</article></div>}

      {showLiveSessionsModal && (
        <div className="overlay">
          <article className="fiat-onramp-modal widget-focused-modal live-sessions-modal">
            <button className="modal-x" onClick={() => setShowLiveSessionsModal(false)}>
              <X size={18} />
            </button>

            {(() => {
              const openSessions = paymentSessionsList.filter((s) => s.status === "open");
              const readySessions = paymentSessionsList.filter((s) => s.status === "ready");
              const completedSessions = paymentSessionsList.filter((s) => s.status === "complete");
              const archivedSessions = paymentSessionsList.filter((s) => s.status === "archived" || s.status === "cancelled" || s.status === "expired");

              const displayedSessions =
                sessionModalTab === "open"
                  ? openSessions
                  : sessionModalTab === "ready"
                  ? readySessions
                  : sessionModalTab === "completed"
                  ? completedSessions
                  : archivedSessions;

              return (
                <>
                  <div className="sessions-modal-head" style={{ marginBottom: "14px" }}>
                    <span className="section-tag">DECOUPLED CLEARING MATRIX</span>
                    <h2>Active Payment Sessions</h2>
                    <p>OffGrid coordinates two independent payment preferences and keeps both sides on one shared settlement record.</p>
                  </div>

                  {/* Horizontal Filter Tabs Aligned Above Session Cards */}
                  <div className="sessions-modal-filter-bar">
                    <button
                      type="button"
                      className={`session-filter-tab-btn ${sessionModalTab === "open" ? "active" : ""}`}
                      onClick={() => setSessionModalTab("open")}
                    >
                      Open ({openSessions.length})
                    </button>
                    <button
                      type="button"
                      className={`session-filter-tab-btn ${sessionModalTab === "ready" ? "active" : ""}`}
                      onClick={() => setSessionModalTab("ready")}
                    >
                      Ready ({readySessions.length})
                    </button>
                    <button
                      type="button"
                      className={`session-filter-tab-btn ${sessionModalTab === "completed" ? "active" : ""}`}
                      onClick={() => setSessionModalTab("completed")}
                    >
                      Completed ({completedSessions.length})
                    </button>
                    <button
                      type="button"
                      className={`session-filter-tab-btn ${sessionModalTab === "archived" ? "active" : ""}`}
                      onClick={() => setSessionModalTab("archived")}
                    >
                      Archived ({archivedSessions.length})
                    </button>
                  </div>

                  <div className="live-sessions-list">
                    {displayedSessions.length === 0 ? (
                      <div className="empty-sessions-box">
                        <Radio size={28} className="spin-slow" />
                        <b>No {sessionModalTab.toUpperCase()} Sessions Found</b>
                        <p>Payment sessions in this stage will appear here automatically.</p>
                      </div>
                    ) : (
                      displayedSessions.map((sess) => {
                        const inviteUrl = sess.sessionPath && typeof window !== "undefined" ? `${window.location.origin}${sess.sessionPath}` : null;
                        return (
                          <div className="live-session-card" key={sess.id}>
                            <div className="session-card-header">
                              <div className="session-title-group">
                                <small style={{ fontFamily: "var(--mono)" }}>SESSION #{sess.id.slice(0, 8)}</small>
                                <h3 style={{ fontFamily: "var(--mono)" }}>${sess.amount} <span style={{ fontFamily: "var(--mono)" }}>USD</span></h3>
                                {sess.memo && <p>{sess.memo}</p>}
                              </div>
                              
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <span className={`session-status-badge ${sess.status}`}>
                                  {sess.status.toUpperCase()}
                                </span>
                                {(sess.status === "open" || sess.status === "ready") && (
                                  <button
                                    type="button"
                                    className="archive-session-btn"
                                    title="Archive session"
                                    onClick={() => archiveSession(sess.inviteTokenHash)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Details Summary Grid Above Progress Bar */}
                            <div className="session-summary-details-grid">
                              <div className="summary-card">
                                <div className="card-tag">
                                  {sess.payerInputRail === "fiat_bank" ? <Banknote size={12} /> : <Wallet size={12} />}
                                  PAYER INPUT
                                </div>
                                <b className="card-val">
                                  {sess.payerInputRail === "fiat_bank" ? "Bank Wire (Circle Mint)" : sess.payerInputRail === "web3_usdc" ? "Web3 USDC (testnet)" : "Awaiting Choice"}
                                </b>
                                <span className="card-status">{sess.payerInputRail ? "Choice Locked" : "Pending Selection"}</span>
                              </div>

                              <div className="summary-card">
                                <div className="card-tag">
                                  <Zap size={12} className="zap-pulse" />
                                  OFFGRID CLEARING
                                </div>
                                <b className="card-val">Live onchain settlement</b>
                                <span className="card-status">SessionEscrow Contract</span>
                              </div>

                              <div className="summary-card">
                                <div className="card-tag">
                                  {sess.receiverOutputRail === "fiat_bank" ? <Banknote size={12} /> : <Wallet size={12} />}
                                  RECEIVER OUTPUT
                                </div>
                                <b className="card-val">
                                  {sess.receiverOutputRail === "fiat_bank" ? "Bank Wire (SEPA/ACH)" : sess.receiverOutputRail === "web3_usdc" ? "Web3 USDC (testnet)" : "Awaiting Choice"}
                                </b>
                                <span className="card-status">{sess.receiverOutputRail ? "Choice Locked" : "Pending Selection"}</span>
                              </div>
                            </div>

                            {/* Animated Progression Pipeline Bar */}
                            <div className="session-animated-progression-bar">
                              <div className="progression-track-line">
                                <div
                                  className="progression-fill-line"
                                  style={{ width: sess.status === "open" ? "33%" : sess.status === "ready" ? "66%" : "100%" }}
                                />
                                <div className="progression-laser-particle" />
                              </div>

                              <div className="progression-step-nodes">
                                <div className="progression-node done">
                                  <div className="node-circle"><Check size={11} /></div>
                                  <span>1. Terms Set</span>
                                </div>

                                <div className={`progression-node ${sess.status === "ready" || sess.status === "complete" ? "done" : "active"}`}>
                                  <div className="node-circle">{sess.status === "ready" || sess.status === "complete" ? <Check size={11} /> : "2"}</div>
                                  <span>2. Choices Locked</span>
                                </div>

                                <div className={`progression-node ${sess.status === "complete" ? "done" : sess.status === "ready" ? "active" : ""}`}>
                                  <div className="node-circle">{sess.status === "complete" ? <Check size={11} /> : <Zap size={11} className="zap-pulse" />}</div>
                                  <span>3. OffGrid settlement</span>
                                </div>

                                <div className={`progression-node ${sess.status === "complete" ? "done" : ""}`}>
                                  <div className="node-circle">{sess.status === "complete" ? <Check size={11} /> : "4"}</div>
                                  <span>4. Settled</span>
                                </div>
                              </div>
                            </div>

                            {/* Shareable Link Toolbar */}
                            <div className="session-card-share-bar">
                              <div className="link-text-box">
                                <LockKeyhole size={13} />
                                <span>{inviteUrl ?? "Original capability link unavailable for this legacy session"}</span>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <a
                                  href={inviteUrl ?? undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`neon-button-sm primary-cta ${inviteUrl ? "" : "disabled"}`}
                                  style={{ textDecoration: "none" }}
                                >
                                  <ExternalLink size={13} /> Open Session
                                </a>
                                <button
                                  type="button"
                                  className="neon-button-sm secondary-ghost"
                                  onClick={() => {
                                    if (inviteUrl && typeof window !== "undefined") {
                                      navigator.clipboard.writeText(inviteUrl);
                                    }
                                  }}
                                  disabled={!inviteUrl}
                                >
                                  <Copy size={13} /> Copy Link
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {sessionError && <p className="inline-error session-modal-error"><CircleAlert size={13} /> {sessionError}</p>}
                </>
              );
            })()}
          </article>
        </div>
      )}

      {hasLiveSession && (() => {
        const current = paymentSessionsList.find((session) => session.nextAction === "pay") ?? paymentSessionsList.find((session) => session.status === "ready") ?? paymentSessionsList.find((session) => session.status === "open");
        if (!current) return null;
        return <button type="button" className="session-status-dock" onClick={() => { setSessionModalTab(current.status === "ready" ? "ready" : "open"); setShowLiveSessionsModal(true); }}><span><Radio size={14} /></span><div><small>LIVE PAYMENT SESSION · {current.id.slice(0, 8).toUpperCase()}</small><b>{current.nextActionLabel}</b><em>{current.amount} USD · {current.status.toUpperCase()}</em></div><ArrowRight size={15} /></button>;
      })()}

      {sessionNotice && <div className="session-notice-toast" role="status"><span><Bell size={15} /></span><div><b>{sessionNotice.title}</b><p>{sessionNotice.detail}</p></div><button type="button" onClick={() => setSessionNotice(null)} aria-label="Dismiss notification"><X size={13} /></button></div>}

      {showFunding && <div className="overlay"><article className="funding-modal">
        <button className="modal-x" onClick={() => setShowFunding(false)}><X size={18} /></button>
        <span className="section-tag">CIRCLE GATEWAY</span>
        <h2>Fund unified balance</h2>
        <p>Deposit USDC from an EVM testnet or Solana Devnet. Each submitted deposit keeps its own proof and continues tracking after this window closes.</p>
        <div className="modal-chain-field"><span>Source network</span><ChainSelect value={depositChain} chains={SOURCE_CHAINS} onChange={(chain) => { setDepositChain(chain); setDepositError(""); }} /></div>
        {depositChain === "Solana_Devnet" && <div className={`solana-deposit-wallet ${solanaAddress ? "connected" : ""}`}><ChainLogo chain="Solana_Devnet" size={25}/><div><small>{solanaAddress ? `${solanaWalletName.toUpperCase()} · SOURCE WALLET` : "SOLANA SIGNER REQUIRED"}</small><b>{solanaAddress ? `${solanaUsdcBalance === null ? "-" : displayMoney(solanaUsdcBalance)} USDC` : "Phantom · Solflare · Backpack"}</b>{solanaAddress && <em>{shortAddress(solanaAddress, 6)}</em>}</div><button onClick={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={13}/> : solanaAddress ? <RefreshCw size={13}/> : <Wallet size={13}/>} {solanaAddress ? "Refresh" : "Connect"}</button></div>}
        <label>Amount<div className="fund-amount"><input value={depositAmount} onChange={(event) => { setDepositAmount(event.target.value.replace(/[^0-9.]/g, "")); setDepositError(""); }} inputMode="decimal" /><span>USDC</span></div></label>
        <div className="gateway-diagram"><ChainName chain={depositChain} size={20}/><i><ArrowRight size={16} /></i><span>Gateway</span><i><ArrowRight size={16} /></i><span>Unified</span></div>
        {gatewayDeposits.some((deposit) => deposit.sourceChain === depositChain && deposit.status !== "confirmed" && deposit.status !== "failed") && <div className="funding-background-note"><Radio size={14}/><div><b>Another deposit is still tracking</b><p>You can submit this one safely. Both transactions will remain in History with independent status.</p></div></div>}
        <button className="neon-button" onClick={depositToGateway} disabled={depositBusy || !walletAddress || !(Number(depositAmount) > 0) || (depositChain === "Solana_Devnet" && !solanaAddress)}>{depositBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />} {depositBusy ? "Confirm in wallet..." : "Review deposit in wallet"}</button>
        {depositError && <div className="funding-error" role="alert"><CircleAlert size={16}/><div><b>Deposit was not submitted</b><p>{depositError}</p></div></div>}
        {solanaError && <div className="funding-error" role="alert"><CircleAlert size={16}/><div><b>Solana connection needs attention</b><p>{describeSolanaReadIssue(solanaError)}</p></div></div>}
        <small><ShieldCheck size={12} /> Base, Arbitrum, and Ethereum deposits require about 13 to 19 minutes of finality before Circle credits the balance.</small>
      </article></div>}

      {showOnRamp && <FiatOnRampModal onClose={() => setShowOnRamp(false)} walletAddress={displayWalletAddress} onSuccess={() => { void loadBalances(); void refreshCurrentUser(); }} />}

      {invoice && <Invoice invoice={invoice} user={user} onClose={resetPayment} />}
    </main>
  );
}
