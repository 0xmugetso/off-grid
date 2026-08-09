"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Blocks,
  Bot,
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
  LoaderCircle,
  Lock,
  LockKeyhole,
  LogOut,
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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isAddress } from "viem";
import { NeonMesh } from "@/components/ui/neon-mesh";
import { ArcPayrollClient, getArcMintStep, type BrowserSolanaAdapter, type BrowserViemAdapter, type CircleAdapter, type GatewayMintRetry } from "@/lib/arc/app-kit-client";
import { discoverBrowserWallets, ensureArcTestnet, requestWalletAccount, type BrowserWallet } from "@/lib/arc/browser-wallet";
import { ARC, CCTP_SOURCE_CHAINS, CHAIN_LABELS, SOURCE_CHAINS, type CctpSourceChain, type SourceChain } from "@/lib/arc/config";
import { connectSolanaWallet as requestSolanaAccount, discoverSolanaWallets, getSolanaWalletProvider, type SolanaBrowserWallet } from "@/lib/arc/solana-wallet";
import type { PaymentRail, PaymentSessionView } from "@/lib/payment-session-types";
import { MassPaymentView, type MassFunding, type MassRunResult, type MassTeamMember } from "@/components/mass-payment-view";
import { ChainLogo, ChainName, ChainSelect } from "@/components/chain-logo";
import { FiatOnRampModal } from "@/components/fiat-onramp-modal";
import { isSubmittedCctpOperation } from "@/lib/cctp-operations";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReceiptCodeRain } from "@/components/receipt-code-rain";

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
  bridgeSteps?: Array<{ name: string; txHash?: string; explorerUrl?: string }>;
  txHash: string;
  explorerUrl: string;
  status: "confirmed";
  memo: string;
  createdAt: string;
}

type AuthMode = "login" | "register";
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
type DepositNotice = {
  state: "submitted" | "pending" | "confirmed";
  amount: string;
  chain: string;
  txHash: string;
  explorerUrl?: string;
  detail: string;
  createdAt: string;
};
type GatewayChainBalance = {
  chain: SourceChain;
  confirmed: string;
  pending: string;
  queried: boolean;
};
type GatewayBalanceSnapshot = {
  confirmed: string;
  pending: string;
  chains: GatewayChainBalance[];
  savedAt: string;
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

function gatewayCacheKey(address: string) {
  return `offgrid:gateway:testnet:${address.toLowerCase()}`;
}

function readGatewaySnapshot(address: string): GatewayBalanceSnapshot | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(gatewayCacheKey(address)) ?? "null") as GatewayBalanceSnapshot | null;
    return parsed?.confirmed && Array.isArray(parsed.chains) ? parsed : null;
  } catch {
    return null;
  }
}

function writeGatewaySnapshot(address: string, snapshot: GatewayBalanceSnapshot) {
  try { window.localStorage.setItem(gatewayCacheKey(address), JSON.stringify(snapshot)); } catch { /* private mode */ }
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
  return "ARC WALLET";
}

function cctpStatusDetail(operation: CctpOperation) {
  if (operation.errorMessage && /took too long|timed? out/i.test(operation.errorMessage)) return "Source RPC timed out before wallet submission";
  if (operation.errorMessage) return operation.errorMessage.split("\n")[0];
  if (operation.status === "attesting") return "Waiting for Circle attestation";
  if (operation.status === "minting") return "Attested; waiting for Arc mint confirmation";
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

function bridgeFeeSummary(estimate: { fees?: Array<{ amount?: string | null; token?: string }> }) {
  const fees = estimate.fees?.filter((fee) => fee.amount && Number(fee.amount) > 0) ?? [];
  if (!fees.length) return "No CCTP protocol fee on standard transfer";
  return fees.map((fee) => `${fee.amount} ${fee.token ?? "USDC"}`).join(" + ");
}

function compactPaymentError(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
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
      return { title: "Arc mint needs recovery", detail: "Gateway accepted the source transfer, but Arc did not confirm the mint. The source transfer will not be submitted again; retry the saved mint when Arc RPC responds.", retryable: true };
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

function shortAddress(address: string, size = 5) {
  return `${address.slice(0, size + 2)}…${address.slice(-4)}`;
}

function displayMoney(value: string | number, digits = 2) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
          username: tab === "register" ? username : undefined,
          displayName: tab === "register" ? displayName : undefined,
        }),
      });

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
        <div className="auth-orbit orbit-one"><span>BASE</span><i /></div>
        <div className="auth-orbit orbit-two"><span>SOL</span><i /></div>
        <div className="auth-center"><Logo /><b>ARC</b><small>SETTLEMENT CORE</small></div>
        <div className="auth-copy">
          <span className="signal-pill"><Radio size={12} /> ARC TESTNET LIVE</span>
          <h1>Money without<br /><em>borders.</em></h1>
          <p>Connect any balance. Pay any person. Settle globally with deterministic finality.</p>
          <div className="auth-proof"><span><Zap size={15} /> ~0.48s finality</span><span><ShieldCheck size={15} /> Self-custodial</span><span><Network size={15} /> Cross-chain</span></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-brand"><Logo /><b>offgrid</b><span>TESTNET v0.2.0</span></div>
        <div className="auth-form">
          <div className="auth-form-head">
            <span><Fingerprint size={16} /> {tab === "signin" ? "SECURE WALLET SIGN-IN" : "CREATE OFFGRID ACCOUNT"}</span>
            <h2>{tab === "signin" ? "Welcome back" : "Create your OffGrid ID"}</h2>
            <p>{tab === "signin" ? "Sign in to your payment command center with your Web3 wallet." : "Set your display name and handle to bind with your Web3 wallet."}</p>
          </div>
          {tab === "register" && (
            <div className="auth-row">
              <label>Display name (optional)
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Morgan" />
              </label>
              <label>Username / Handle
                <div className="prefix-input">
                  <span>@</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alex or ens/0xwallet" />
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
            <button type="button" onClick={() => { setTab(tab === "signin" ? "register" : "signin"); setError(""); }}>
              {tab === "signin" ? "Register here" : "Sign in here"}
            </button>
          </p>
        </div>
        <p className="auth-security"><LockKeyhole size={13} /> Zero password custody. Cryptographic signatures verify wallet ownership.</p>
      </section>
    </main>
  );
}

function Invoice({ invoice, user, onClose }: { invoice: InvoiceData; user: User; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/invoice/${invoice.id}`;

  async function share() {
    const shareData = { title: `OffGrid receipt — ${invoice.amount} USDC`, text: `${user.displayName} paid ${invoice.recipientLabel} on Arc Testnet.`, url: shareUrl };
    if (navigator.share) await navigator.share(shareData);
    else { await navigator.clipboard.writeText(shareUrl); setCopied(true); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(invoice, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `offgrid-${invoice.id}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="overlay">
      <ReceiptCodeRain modal />
      <article className="invoice-modal">
        <button className="modal-x" onClick={onClose}><X size={18} /></button>
        <div className="invoice-beam"><i /><span><Check size={30} /></span><i /></div>
        <span className="invoice-status"><Radio size={11} /> FINALIZED ON ARC</span>
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
        <div className="invoice-actions"><button className="neon-button" onClick={share}><Share2 size={16} /> {copied ? "Link copied" : "Share receipt"}</button><button onClick={download}><Download size={16} /> Download</button></div>
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
  };
};

function proofSteps(entry: LedgerEntry): Array<{ label: string; detail: string; tone: "muted" | "good" | "warning"; txHash?: string; explorerUrl?: string }> {
  const statusLabel = entry.status === "confirmed" ? "Confirmed" : entry.status === "failed" ? "Failed" : entry.status === "submitted" ? "Submitted" : "Pending";
  const sandboxTransfer = /sandbox fiat transfer/i.test(entry.activity) || /sandbox fiat balance/i.test(entry.rail);
  if (entry.kind === "fiat") {
    return sandboxTransfer
      ? [
          { label: "Transfer request", detail: "A sandbox fiat transfer was submitted against the local ledger.", tone: "muted" as const },
          { label: "Transfer ID", detail: entry.txHash, txHash: entry.txHash, tone: "good" as const },
          { label: "Balance update", detail: `${statusLabel} · the sender and recipient fiat balances were updated in OffGrid.`, tone: "good" as const },
        ]
      : [
          { label: "Payout request", detail: "The sandbox bank payout was submitted from the live session.", tone: "muted" as const },
          { label: "Circle payout ID", detail: entry.meta?.circlePayoutId ?? entry.txHash, txHash: (entry.meta?.circlePayoutId ?? entry.txHash) || undefined, explorerUrl: entry.explorerUrl || undefined, tone: "good" as const },
          { label: "Bank route", detail: `${entry.meta?.bankAccountId ?? "Linked Circle Mint bank account"} · ${statusLabel}${entry.meta?.trackingRef ? ` · tracking ${entry.meta.trackingRef}` : ""}`, tone: entry.status === "failed" ? "warning" as const : "good" as const },
        ];
  }
  if (entry.kind === "cctp") {
    const burnLog = entry.logs.find((log) => /burn/i.test(log.name));
    const mintLog = entry.logs.find((log) => /mint|attest/i.test(log.name));
    return [
      { label: "Intent", detail: "CCTP was selected to move source-chain USDC to Arc.", tone: "muted" as const },
      { label: "Source burn", detail: burnLog?.txHash ? "Circle can trace the source burn transaction." : "Waiting for the source burn to appear.", txHash: burnLog?.txHash, explorerUrl: burnLog?.explorerUrl, tone: burnLog?.txHash ? "good" as const : "warning" as const },
      { label: "Arc mint", detail: mintLog?.txHash ? "The Arc mint was recorded in the settlement trail." : "Mint not yet recorded in the trail.", txHash: mintLog?.txHash, explorerUrl: mintLog?.explorerUrl, tone: mintLog?.txHash ? "good" as const : "warning" as const },
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
    { label: "Intent", detail: "A direct Arc transfer or Gateway spend was executed.", tone: "muted" as const },
    { label: "Transaction hash", detail: entry.txHash, txHash: entry.txHash, explorerUrl: entry.explorerUrl, tone: "good" as const },
    { label: "Receipt", detail: entry.receiptUrl ? "A matching OffGrid receipt is available." : statusLabel, tone: entry.receiptUrl ? "good" as const : "muted" as const },
  ];
}

function HistoryView({ invoices, deposit, cctpOperations, fiatPayouts, recovering, recoveryNote, onRecover, onRefreshCctp, onRefreshFiat, onSelectEntry }: { invoices: InvoiceData[]; deposit: DepositNotice | null; cctpOperations: CctpOperation[]; fiatPayouts: FiatPayout[]; recovering: boolean; recoveryNote: string; onRecover: () => void; onRefreshCctp: () => void; onRefreshFiat: () => void; onSelectEntry: (entry: LedgerEntry) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | LedgerEntry["kind"]>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "amount_high" | "amount_low">("newest");
  const [copiedHash, setCopiedHash] = useState("");
  const [recoveryChain, setRecoveryChain] = useState<CctpSourceChain>("Base_Sepolia");
  const [recoveryHash, setRecoveryHash] = useState("");
  const [manualRecoveryBusy, setManualRecoveryBusy] = useState(false);
  const [manualRecoveryNote, setManualRecoveryNote] = useState("");

  const entries = useMemo<LedgerEntry[]>(() => {
    const payments = invoices.map((item): LedgerEntry => ({
      id: item.id,
      activity: item.fundingMethod === "fiat_bank" ? `Sandbox fiat transfer to ${item.recipientLabel}` : `Payment to ${item.recipientLabel}`,
      detail: item.memo || `${fundingLabel(item.fundingMethod)} settlement`,
      kind: item.fundingMethod === "cctp_bridge" ? "cctp" : item.fundingMethod === "unified_balance" ? "gateway" : item.fundingMethod === "fiat_bank" ? "fiat" : "transfer",
      rail: item.fundingMethod === "cctp_bridge" ? "CCTP V2" : item.fundingMethod === "unified_balance" ? "Gateway spend" : item.fundingMethod === "fiat_bank" ? "Sandbox fiat balance" : "Arc transfer",
      amount: item.amount,
      txHash: item.txHash,
      explorerUrl: item.explorerUrl,
      receiptUrl: `/invoice/${item.id}`,
      status: "confirmed",
      createdAt: item.createdAt,
      logs: item.bridgeSteps?.length
        ? item.bridgeSteps.map((step) => ({ name: step.name, txHash: step.txHash, explorerUrl: step.explorerUrl }))
        : item.fundingMethod === "fiat_bank"
          ? [{ name: "Sandbox debit", txHash: item.txHash }, { name: "Sandbox credit", txHash: item.txHash }]
          : [{ name: item.protocol === "gateway" ? "Gateway settlement" : "Arc settlement", txHash: item.txHash, explorerUrl: item.explorerUrl }],
    }));
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
    if (!deposit) return ledger;
    return [{
      id: `deposit-${deposit.txHash}`,
      activity: "Fund unified balance",
      detail: deposit.detail,
      kind: "deposit",
      rail: `${CHAIN_LABELS[deposit.chain as SourceChain] ?? deposit.chain} → Gateway`,
      amount: deposit.amount,
      txHash: deposit.txHash,
      explorerUrl: deposit.explorerUrl ?? "",
      status: deposit.state,
      createdAt: deposit.createdAt,
      logs: [{ name: `Gateway deposit ${deposit.state}`, txHash: deposit.txHash, explorerUrl: deposit.explorerUrl }],
    }, ...ledger];
  }, [cctpOperations, deposit, fiatPayouts, invoices]);

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries
      .filter((entry) => filter === "all" || entry.kind === filter)
      .filter((entry) => !normalized || [entry.activity, entry.detail, entry.rail, entry.txHash].some((value) => value.toLowerCase().includes(normalized)))
      .sort((a, b) => sort === "newest" ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : sort === "oldest" ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : sort === "amount_high" ? Number(b.amount) - Number(a.amount)
            : Number(a.amount) - Number(b.amount));
  }, [entries, filter, query, sort]);

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
      setManualRecoveryNote(result.imported > 0 ? `Transfer restored${result.confirmed ? " and confirmed on Arc" : "; live tracking is active"}.` : "That burn is already tracked.");
      onRefreshCctp();
    } catch (error) {
      setManualRecoveryNote(error instanceof Error ? error.message : "Could not recover that CCTP transaction");
    } finally {
      setManualRecoveryBusy(false);
    }
  }

  return <section className="history-view">
    <div className="view-heading"><div><span className="section-tag">TRANSACTION INTELLIGENCE</span><h1>History</h1><p>Every real OffGrid settlement, protocol log, and transaction proof in one place.</p></div><div className="history-live-actions"><button className="quiet-refresh" onClick={onRecover} disabled={recovering}>{recovering ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {recovering ? "Scanning chains…" : "Recover CCTP"}</button><span className="live-data-pill"><i /> LIVE TESTNET DATA</span></div></div>
    {(recoveryNote || manualRecoveryNote) && <p className="history-recovery-note"><CircleCheck size={13}/>{manualRecoveryNote || recoveryNote}</p>}
    <form className="cctp-hash-recovery" onSubmit={(event) => { event.preventDefault(); void recoverHash(); }}><div><span className="section-tag">MISSING A CCTP TRANSFER?</span><p>Paste its source-chain burn hash. OffGrid verifies it with Circle and restores the live attestation or Arc mint status.</p></div><ChainSelect value={recoveryChain} chains={CCTP_SOURCE_CHAINS.filter((chain) => chain !== "Solana_Devnet")} onChange={(chain) => setRecoveryChain(chain as CctpSourceChain)} /><label><Search size={13}/><input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value.trim())} placeholder="0x source transaction hash" /></label><button type="submit" disabled={manualRecoveryBusy || !/^0x[a-fA-F0-9]{64}$/.test(recoveryHash)}>{manualRecoveryBusy ? <LoaderCircle className="spin" size={12}/> : <Blocks size={12}/>} Track transfer</button></form>
    <CctpOperationsTray operations={cctpOperations} onRefresh={onRefreshCctp} />
    <div className="history-stats">
      <article><small>TOTAL ACTIVITY</small><b>{entries.length}</b><p>{confirmed} confirmed · {pending} in flight · {failed} failed</p></article>
      <article><small>ONCHAIN VOLUME</small><b>{displayMoney(volume)} <em>USDC</em></b><p>Only submitted or confirmed transactions</p></article>
      <article><small>SUCCESS RATE</small><b>{confirmed + failed ? `${Math.round((confirmed / (confirmed + failed)) * 100)}%` : "—"}</b><p>Confirmed versus failed outcomes</p></article>
      <article><small>ACTIVE ROUTES</small><b>{rails}</b><p>Distinct settlement rails used</p></article>
    </div>
    <div className="ledger-panel">
      <div className="ledger-toolbar"><div><b>Activity ledger</b><small>{visibleEntries.length} of {entries.length} transactions</small></div><label className="ledger-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity or transaction ID" /></label><label className="ledger-select"><span>TYPE</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All activity</option><option value="transfer">Arc transfers</option><option value="gateway">Gateway spends</option><option value="cctp">CCTP bridges</option><option value="deposit">Deposits</option><option value="fiat">Bank payouts</option></select><ChevronDown size={12} /></label><label className="ledger-select"><span>SORT</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount_high">Amount: high</option><option value="amount_low">Amount: low</option></select><ChevronDown size={12} /></label></div>
      <div className="ledger-table-wrap"><table className="ledger-table"><thead><tr><th>Status</th><th>Activity / logs</th><th>Route</th><th>Transaction ID</th><th>Date</th><th>Amount</th><th /></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.id}><td><span className={`ledger-status ${entry.status}`}><i />{entry.status}</span></td><td><div className="ledger-activity"><b>{entry.activity}</b><small>{entry.detail}</small><details><summary>{entry.logs.length} protocol {entry.logs.length === 1 ? "log" : "logs"}</summary><div>{entry.logs.map((log, index) => <span key={`${log.name}-${index}`}><i />{log.name}{log.txHash && <em>{shortAddress(log.txHash, 6)}</em>}</span>)}</div></details></div></td><td><span className={`route-badge ${entry.kind}`}>{entry.rail}</span></td><td>{entry.txHash ? <div className="tx-id"><code>{shortAddress(entry.txHash, 7)}</code><button onClick={() => copyHash(entry.txHash)} aria-label="Copy transaction ID">{copiedHash === entry.txHash ? <Check size={12} /> : <Copy size={12} />}</button></div> : <span className="tx-not-submitted">NOT SUBMITTED</span>}</td><td><time>{new Date(entry.createdAt).toLocaleDateString()}<small>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></time></td><td><strong>{displayMoney(entry.amount)}<small>USDC</small></strong></td><td><div className="ledger-actions"><button className="ledger-proof-button" onClick={() => onSelectEntry(entry)}>Proof</button>{entry.receiptUrl ? <a href={entry.receiptUrl} aria-label="Open receipt"><ExternalLink size={13} /></a> : entry.explorerUrl ? <a href={entry.explorerUrl} target="_blank" rel="noreferrer" aria-label="Open transaction"><ExternalLink size={13} /></a> : null}</div></td></tr>)}</tbody></table>{visibleEntries.length === 0 && <div className="ledger-empty"><Receipt size={24} /><b>{entries.length ? "No transactions match these filters" : "No onchain activity yet"}</b><p>{entries.length ? "Adjust the search, type, or sorting controls." : "Completed transfers and Gateway deposits will appear here automatically."}</p></div>}</div>
    </div>
  </section>;
}

function UnifiedBalanceView({ walletAddress, walletOnArc, arcBalance, unifiedBalance, pendingBalance, chainBalances, gatewayError, gatewayStale, solanaAddress, solanaWalletName, solanaUsdcBalance, solanaBusy, onRefresh, onDeposit, onConnect, onConnectSolana }: { walletAddress: string; walletOnArc: boolean; arcBalance: string | null; unifiedBalance: string | null; pendingBalance: string | null; chainBalances: GatewayChainBalance[] | null; gatewayError: string; gatewayStale: boolean; solanaAddress: string; solanaWalletName: string; solanaUsdcBalance: string | null; solanaBusy: boolean; onRefresh: () => void; onDeposit: () => void; onConnect: () => void; onConnectSolana: () => void }) {
  const confirmed = Number(unifiedBalance ?? 0);
  const pending = Number(pendingBalance ?? 0);
  const total = confirmed + pending;
  return <section className="unified-view">
    <div className="view-heading"><div><span className="section-tag">CIRCLE GATEWAY</span><h1>Unified Balance</h1><p>One spendable USDC balance assembled from supported testnet chains.</p></div>{walletAddress && <button className="quiet-refresh" onClick={onRefresh}><RefreshCw size={13} /> Refresh balances</button>}</div>
    {!walletAddress ? <div className="unified-empty"><Network size={30} /><h2>Connect a wallet to query Gateway.</h2><p>OffGrid will read only real confirmed and pending balances for your connected address.</p><button className="neon-button" onClick={onConnect}><Wallet size={15} /> Connect wallet</button></div> : <>
      <section className={`unified-hero ${gatewayStale ? "stale" : ""}`}><div><span><Network size={18} /></span><small>TOTAL GATEWAY POSITION</small><b>{displayMoney(total)} <em>USDC</em></b><p>{gatewayError || "Confirmed plus deposits currently indexing"}</p></div><div className="unified-breakdown"><span><small>SPENDABLE NOW</small><b>{displayMoney(confirmed)} USDC</b><i><em style={{ width: `${total > 0 ? (confirmed / total) * 100 : 0}%` }} /></i></span><span><small>PENDING INDEXING</small><b>{displayMoney(pending)} USDC</b><i className="pending"><em style={{ width: `${total > 0 ? (pending / total) * 100 : 0}%` }} /></i></span></div><button className="unified-deposit-cta" onClick={onDeposit}><Plus size={16} /><span><small>ADD LIQUIDITY</small><b>Deposit to Gateway</b></span><ArrowRight size={15} /></button><div className="unified-hero-orbit session-launch-glow" aria-hidden="true" /></section>
      <div className="unified-chain-head"><div><span className="section-tag">SOURCE ALLOCATION</span><h2>Balance by chain</h2><p>Live Gateway positions returned by Circle App Kit for this connected account.</p></div><span><i /> CONFIRMED <i /> PENDING</span></div>
      <div className="unified-chain-grid">{(chainBalances ?? SOURCE_CHAINS.map((chain) => ({ chain, confirmed: "0", pending: "0", queried: chain !== "Solana_Devnet" }))).map((position) => <article className={!position.queried ? "unlinked" : ""} key={position.chain}><div className="unified-chain-logo"><ChainLogo chain={position.chain} size={33}/></div><div><small>{CHAIN_LABELS[position.chain].toUpperCase()}</small><b>{position.queried ? displayMoney(position.confirmed) : "—"} <em>USDC</em></b><p>{!position.queried ? "Connect Solana wallet to query" : Number(position.pending) > 0 ? `${displayMoney(position.pending)} USDC pending` : "Gateway confirmed"}</p></div><span className={Number(position.pending) > 0 ? "pending" : "online"}><i />{Number(position.pending) > 0 ? "INDEXING" : position.queried ? "LIVE" : "UNLINKED"}</span></article>)}</div>
      <div className="unified-wallet-balance"><ChainLogo chain="Arc_Testnet" size={25}/><div><small>DIRECT ARC WALLET · OUTSIDE GATEWAY</small><b>{arcBalance === null ? "—" : displayMoney(arcBalance)} USDC</b></div><span>{walletOnArc ? "ARC ACTIVE" : "CONNECTED ON ANOTHER CHAIN"}</span></div>
      <div className={`unified-wallet-balance solana-wallet-balance ${solanaAddress ? "connected" : ""}`}><ChainLogo chain="Solana_Devnet" size={25}/><div><small>{solanaAddress ? `SOLANA DEVNET · ${solanaWalletName.toUpperCase()}` : "SOLANA DEVNET · SOURCE WALLET"}</small><b>{solanaAddress ? `${solanaUsdcBalance === null ? "—" : displayMoney(solanaUsdcBalance)} USDC` : "Connect to deposit or bridge"}</b>{solanaAddress && <em>{shortAddress(solanaAddress, 6)}</em>}</div><button onClick={onConnectSolana} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={12}/> : solanaAddress ? <RefreshCw size={12}/> : <Wallet size={12}/>} {solanaAddress ? "Refresh" : "Connect Solana"}</button></div>
    </>}
  </section>;
}

function CctpOperationsTray({ operations, onRefresh }: { operations: CctpOperation[]; onRefresh: () => void }) {
  const visible = operations.filter((operation) => isSubmittedCctpOperation(operation) && operation.status !== "confirmed").slice(0, 5);
  if (!visible.length) return null;
  const stage = (status: CctpOperation["status"]) => status === "awaiting_signature" ? "Wallet signature" : status === "attesting" ? "Circle attestation" : status === "minting" ? "Forwarder mint" : "Needs attention";
  return <section className="cctp-operations-tray">
    <div className="cctp-tray-head"><div><span><Blocks size={15}/><i /></span><div><small>ONCHAIN CCTP TRACKER</small><b>{visible.length} submitted CCTP {visible.length === 1 ? "transfer" : "transfers"} being tracked</b><p>Only source-chain burns appear here. Preflight and wallet errors are never transaction history.</p></div></div><button onClick={onRefresh}><RefreshCw size={12}/> Refresh status</button></div>
    <div className="cctp-operation-list">{visible.map((operation) => <article className={operation.status} key={operation.id}>
      <ChainLogo chain={operation.sourceChain} size={28}/><div className="cctp-operation-main"><span><b>{displayMoney(operation.amount)} USDC</b><i><ArrowRight size={10}/></i><ChainName chain="Arc_Testnet" size={15}/></span><small>TO {operation.recipientLabel} · {shortAddress(operation.recipientAddress)}</small></div>
      <div className="cctp-operation-stage"><span><i />{stage(operation.status)}</span><small>{operation.status === "failed" ? cctpStatusDetail(operation) : operation.status === "attesting" ? "Waiting for hard finality" : operation.status === "minting" ? "Circle is submitting on Arc" : "Status is stored securely"}</small></div>
      {operation.burnExplorerUrl ? <a href={operation.burnExplorerUrl} target="_blank" rel="noreferrer">Source tx <ExternalLink size={11}/></a> : <span className="cctp-no-hash">{shortAddress(operation.burnTxHash!, 6)}</span>}
    </article>)}</div>
  </section>;
}

interface EscrowItem {
  id: string;
  title: string;
  category: "code" | "digital_goods" | "api_key" | "freelance";
  clientAddress: string;
  clientName: string;
  providerAddress: string;
  providerName: string;
  amount: string;
  specs: string;
  terms?: { summary?: string; paymentFor?: string; criteria?: string; dueDate?: string; tasks: Array<{ description: string; dueDate?: string; responsibleParty?: string; additionalDetails?: string }> };
  contractFileName?: string;
  contractFileHash?: string;
  status: "initiated" | "deploying" | "open" | "approving" | "locking" | "locked" | "validating" | "releasing" | "closed" | "refunding" | "refunded" | "failed" | "created" | "funded" | "submitted" | "validated";
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
  refundTransactionId?: string;
  circleTransactionState?: string;
  paymentId?: number;
  validationResult?: { valid: boolean; confidence: "HIGH" | "MEDIUM" | "LOW"; reasons: string[]; fileName: string; fileHash: string };
  lastError?: string;
  depositTxHash?: string;
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

function CreateEscrowModal({ onClose, onCreated, walletAddress }: { onClose: () => void; onCreated: (item: EscrowItem) => void; walletAddress: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState(""); const [providers, setProviders] = useState<DirectoryUser[]>([]); const [providerAddress, setProviderAddress] = useState("");
  const [file, setFile] = useState<File | null>(null); const [terms, setTerms] = useState<any>(null); const [fileHash, setFileHash] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (query.length < 2) { setProviders([]); return; } const timer = window.setTimeout(() => { void api<{ users: DirectoryUser[] }>(`/api/users?query=${encodeURIComponent(query)}`).then((data) => setProviders(data.users || [])).catch(() => setProviders([])); }, 220); return () => window.clearTimeout(timer); }, [query]);
  const analyze = async (selected: File) => { setBusy(true); setError(""); try { const form = new FormData(); form.append("file", selected); const data = await api<{ terms: any; fileHash: string }>("/api/escrows/analyze", { method: "POST", body: form }); setTerms(data.terms); setFileHash(data.fileHash); setStep(3); } catch (err) { setError(err instanceof Error ? err.message : "Could not analyze agreement"); } finally { setBusy(false); } };
  const submit = async () => { setBusy(true); setError(""); try { const data = await api<{ escrow: EscrowItem }>("/api/escrows", { method: "POST", body: JSON.stringify({ providerAddress, title: terms.title, category: terms.category, amount: terms.amount, specs: terms.criteria, terms, contractFileName: file?.name, contractFileHash: fileHash }) }); onCreated(data.escrow); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Failed to create agreement"); } finally { setBusy(false); } };
  return <div className="overlay"><article className="escrow-wizard-modal"><button className="modal-x" onClick={onClose} aria-label="Close modal"><X size={18}/></button><div className="escrow-wizard-head"><span className="section-tag">CIRCLE REFUND PROTOCOL · ARC TESTNET</span><h2>Open an AI escrow.</h2><p>Choose a verified beneficiary, upload the agreement, review extracted terms, then deploy the official lifecycle.</p></div><div className="escrow-stepper"><div className={`stepper-step ${step >= 1 ? "active" : ""}`}><span>1</span><small>Beneficiary</small></div><i className={step >= 2 ? "active" : ""}/><div className={`stepper-step ${step >= 2 ? "active" : ""}`}><span>2</span><small>Upload</small></div><i className={step >= 3 ? "active" : ""}/><div className={`stepper-step ${step >= 3 ? "active" : ""}`}><span>3</span><small>Review</small></div></div><form className="escrow-wizard-body" onSubmit={(event) => { event.preventDefault(); if (step === 1 && providerAddress) setStep(2); else if (step === 3 && terms) void submit(); }}>{step === 1 && <div className="wizard-step-pane"><label className="wizard-label"><span>WHO WILL DELIVER THE WORK?</span><input className="wizard-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a registered OffGrid user" autoFocus /></label><div className="escrow-recipient-results">{providers.map((provider) => <button type="button" className="escrow-recipient-option" key={provider.id} onClick={() => { setProviderAddress(provider.walletAddress); setQuery(provider.displayName); setProviders([]); }}><UserRound size={16}/><span><b>{provider.displayName}</b><small>@{provider.username} · {provider.walletAddress.slice(0, 8)}…{provider.walletAddress.slice(-6)}</small></span><Check size={15}/></button>)}</div><div className="wizard-info-box"><FileCode size={18}/><div><b>Circle official lifecycle</b><p>Create → deploy → fund → submit evidence → AI validate → withdraw or refund.</p></div></div></div>}{step === 2 && <div className="wizard-step-pane"><label className="wizard-label"><span>UPLOAD AGREEMENT</span><input className="wizard-input" type="file" accept=".pdf,.docx,image/png,image/jpeg,image/webp" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) { setFile(selected); void analyze(selected); } }} autoFocus /></label><div className="wizard-info-box"><FileCheck size={18}/><div><b>{file?.name || "Agreement document"}</b><p>{busy ? "Extracting amount, tasks, due dates, and acceptance criteria…" : "PDF, DOCX, PNG, JPG, or WEBP · max 10 MB"}</p></div></div></div>}{step === 3 && terms && <div className="wizard-step-pane"><label className="wizard-label"><span>AGREEMENT TITLE</span><input className="wizard-input" value={terms.title} onChange={(event) => setTerms({ ...terms, title: event.target.value })}/><span>AMOUNT (USDC)</span><input className="wizard-input" value={terms.amount} onChange={(event) => setTerms({ ...terms, amount: event.target.value.replace(/[^0-9.]/g, "") })}/><span>AI ACCEPTANCE CRITERIA</span><textarea className="wizard-textarea" value={terms.criteria} onChange={(event) => setTerms({ ...terms, criteria: event.target.value })} rows={3}/></label><div className="escrow-review-summary"><span><small>PAYMENT FOR</small><b>{terms.paymentFor || "Not specified"}</b></span><span><small>DELIVERABLES</small><b>{terms.tasks?.length || 0} task(s)</b></span></div></div>}{error && <p className="inline-error"><CircleAlert size={13}/> {error}</p>}<div className="wizard-actions">{step > 1 ? <button type="button" className="wizard-back-btn" onClick={() => setStep((value) => (value - 1) as 1 | 2 | 3)}>Back</button> : <span/>}{step === 1 ? <button type="submit" className="neon-button" disabled={!providerAddress}>Continue to upload <ArrowRight size={15}/></button> : step === 2 ? <span className="wizard-field-note">We analyze the document before any funds or contracts are touched.</span> : <button type="submit" className="neon-button" disabled={busy || !terms?.criteria || Number(terms?.amount) <= 0}>{busy ? <LoaderCircle className="spin" size={16}/> : <Scale size={16}/>} Create agreement</button>}</div></form></article></div>;
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
          <p>AI-validated digital goods and code delivery escrows with sub-second USDC settlement on Arc Testnet.</p>
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
            <p>Create your first proof escrow for digital goods, code repositories, or freelance tasks with Arc transaction evidence.</p>
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
                    <input value={proofTxHash} onChange={(event) => setProofTxHash(event.target.value)} placeholder="Paste the confirmed Arc funding tx hash" spellCheck={false} />
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
                    <input value={proofTxHash} onChange={(event) => setProofTxHash(event.target.value)} placeholder="Paste the confirmed Arc release tx hash" spellCheck={false} />
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
              <span><small>RAIL</small><b>Arc Testnet Vault</b></span>
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
  const hasPendingAction = escrows.some((item) => ["deploying", "approving", "locking", "validating", "releasing", "refunding"].includes(item.status));
  useEffect(() => {
    if (!hasPendingAction) return;
    const timer = window.setInterval(() => { if (!document.hidden) void loadEscrows(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [hasPendingAction]);

  const updateEscrow = (escrow: EscrowItem) => {
    setEscrows((previous) => previous.map((entry) => entry.id === escrow.id ? escrow : entry));
    setActiveEscrow((current) => current?.id === escrow.id ? escrow : current);
  };

  const handleAction = async (item: EscrowItem, action: "deploy" | "fund" | "refund" | "refresh") => {
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
  const pending = new Set(["deploying", "approving", "locking", "validating", "releasing", "refunding"]);
  const tvl = escrows.filter((item) => ["locked", "validating", "releasing"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0);
  const settled = escrows.filter((item) => item.status === "closed").reduce((sum, item) => sum + Number(item.amount), 0);
  const flowIndex = (status: EscrowItem["status"]) => status === "initiated" ? 0 : ["deploying", "open"].includes(status) ? 1 : ["approving", "locking", "locked"].includes(status) ? 2 : status === "validating" ? 3 : ["releasing", "closed", "refunded"].includes(status) ? 4 : 0;
  const transactionHash = (item: EscrowItem) => item.releaseTxHash || item.refundTxHash || item.depositTxHash;

  return <section className="escrow-view">
    <div className="view-heading"><div><span className="section-tag">CIRCLE REFUND PROTOCOL · ARC TESTNET</span><h1>AI Escrow</h1><p>The exact official Arc escrow sequence—agreement, contract deployment, USDC lock, vision validation, then onchain release or refund—in OffGrid&apos;s workflow.</p></div><div className="escrow-live-actions"><button className="quiet-refresh" onClick={() => { void loadEscrows(); onRefresh(); }}><RefreshCw size={13}/> Refresh</button><button className="neon-button" onClick={() => walletAddress ? setShowCreateModal(true) : onConnect()}><Plus size={15}/> {walletAddress ? "Create AI Escrow" : "Connect wallet"}</button></div></div>

    <div className="escrow-stats-grid"><article className="escrow-stat-card"><small><Lock size={13}/> ACTIVE COMMITMENTS</small><b>{displayMoney(tvl)} <em>USDC</em></b><p>Locked in deployed RefundProtocol contracts</p></article><article className="escrow-stat-card"><small><Scale size={13}/> RELEASED ONCHAIN</small><b>{displayMoney(settled)} <em>USDC</em></b><p>AI-approved Arc withdrawals</p></article><article className="escrow-stat-card"><small><Bot size={13}/> HIGH CONFIDENCE</small><b>{escrows.filter((item) => item.validationResult?.confidence === "HIGH").length} <em>VALIDATIONS</em></b><p>Image evidence matched to agreement rules</p></article><article className="escrow-stat-card"><small><Zap size={13}/> ARC WALLET</small><b>{arcBalance === null ? "—" : displayMoney(arcBalance)} <em>USDC</em></b><p>Your connected wallet balance; escrow uses Circle SCAs</p></article></div>

      {configuration && (!configuration.configured || !configuration.ai.configured) && <div className="escrow-setup-banner"><ShieldAlert size={18}/><div><b>Live escrow setup is incomplete</b><p>Add {configuration.missing.join(", ")}{!configuration.ai.configured ? ` and ${configuration.ai.missing.join(", ")}` : ""} to Vercel. AI validator: {configuration.ai.provider} · {configuration.ai.model}.</p></div></div>}
    {actionError && <div className="escrow-action-error"><CircleAlert size={15}/><span><b>Escrow action stopped</b>{actionError}</span><button onClick={() => setActionError("")}><X size={13}/></button></div>}

    <div className="escrow-list-panel"><div className="ledger-toolbar"><div><b>RefundProtocol agreements</b><small>{escrows.length} participant agreement{escrows.length === 1 ? "" : "s"} · live Circle transaction status</small></div></div>
      {loading ? <div className="escrow-empty-state"><LoaderCircle className="spin" size={25}/><h3>Loading escrow state</h3><p>Reading agreements and Circle transaction status.</p></div> : escrows.length === 0 ? <div className="escrow-empty-state"><div className="escrow-empty-icon"><Scale size={28}/></div><h3>No escrow agreements yet</h3><p>Create terms with another registered OffGrid user, then deploy Circle&apos;s RefundProtocol on Arc Testnet.</p><button className="neon-button" onClick={() => walletAddress ? setShowCreateModal(true) : onConnect()}><Plus size={15}/> {walletAddress ? "Create escrow agreement" : "Connect wallet"}</button></div> : <div className="escrow-cards-grid">{escrows.map((item) => <article key={item.id} className={`escrow-item-card ${item.status}`}>
        <div className="escrow-card-head"><span className={`escrow-category-badge ${item.category}`}>{item.category === "code" ? <FileCode size={12}/> : item.category === "api_key" ? <Bot size={12}/> : <FileCheck size={12}/>}{item.category.toUpperCase().replace("_", " ")}</span><span className={`escrow-status-pill ${item.status}`}><i/>{item.status.toUpperCase()}</span></div>
        <h3>{item.title}</h3><p className="escrow-specs-text">{item.terms?.summary || item.specs}</p>{item.terms?.tasks?.length ? <div className="escrow-task-strip"><small>{item.terms.tasks.length} OFFICIAL DELIVERABLE{item.terms.tasks.length === 1 ? "" : "S"}</small><span>{item.terms.tasks.slice(0, 2).map((task) => task.description).join(" · ")}</span></div> : null}
        <div className="escrow-flow-line">{["Agreement", "Contract", "USDC locked", "AI check", "Settlement"].map((label, index) => <span key={label} className={index <= flowIndex(item.status) ? "active" : ""}><i>{index < flowIndex(item.status) ? <Check size={9}/> : index + 1}</i><small>{label}</small></span>)}</div>
        <div className="escrow-participants"><div><small>DEPOSITOR</small><b>{item.clientName}</b></div><ArrowRight size={14} className="arrow-split"/><div><small>BENEFICIARY</small><b>{item.providerName}</b></div></div>
        <div className="escrow-amount-row"><span><small>{["locked", "validating", "releasing"].includes(item.status) ? "LOCKED AMOUNT" : item.status === "closed" ? "RELEASED AMOUNT" : "AGREED AMOUNT"}</small><b>{displayMoney(item.amount)} USDC</b></span><button className="escrow-detail-btn" onClick={() => setActiveEscrow(item)}>Inspect protocol <ArrowRight size={12}/></button></div>
        {item.lastError && <p className="escrow-card-error"><CircleAlert size={12}/>{item.lastError}</p>}
        {item.status === "initiated" && isDepositor(item) && <button className="neon-button escrow-action-full" disabled={!configuration?.configured || Boolean(actionBusy)} onClick={() => void handleAction(item, "deploy")}>{actionBusy === `${item.id}:deploy` ? <LoaderCircle className="spin" size={14}/> : <Blocks size={14}/>} Deploy RefundProtocol</button>}
        {item.status === "initiated" && !isDepositor(item) && <div className="escrow-waiting-banner"><Clock size={14}/> Waiting for the depositor to deploy the contract</div>}
        {item.status === "open" && isDepositor(item) && <div className="escrow-circle-wallet"><small>FUND THIS CIRCLE SCA WALLET FIRST</small><code>{item.depositorCircleWalletAddress}</code><p>Use Circle&apos;s Arc testnet faucet, then approve and lock the agreed USDC.</p><a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Open faucet <ExternalLink size={11}/></a><button className="neon-button escrow-action-full" disabled={Boolean(actionBusy)} onClick={() => void handleAction(item, "fund")}>{actionBusy === `${item.id}:fund` ? <LoaderCircle className="spin" size={14}/> : <Lock size={14}/>} Approve &amp; lock {displayMoney(item.amount)} USDC</button></div>}
        {item.status === "open" && !isDepositor(item) && <div className="escrow-waiting-banner"><Clock size={14}/> Contract deployed · waiting for depositor funding</div>}
        {item.status === "locked" && isBeneficiary(item) && <div className="escrow-evidence-action"><label><FileCheck size={14}/><span><b>{evidenceFiles[item.id]?.name || "Choose image evidence"}</b><small>PNG, JPG, WEBP · max 5 MB</small></span><input type="file" accept="image/*" onChange={(event) => setEvidenceFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] }))}/></label><div><button className="neon-button" disabled={!evidenceFiles[item.id] || Boolean(actionBusy)} onClick={() => void validateEvidence(item)}>{actionBusy === `${item.id}:validate` ? <LoaderCircle className="spin" size={14}/> : <Bot size={14}/>} Validate &amp; release</button><button className="escrow-refund-button" disabled={Boolean(actionBusy)} onClick={() => void handleAction(item, "refund")}><Unlock size={13}/> Refund depositor</button></div></div>}
        {item.status === "locked" && !isBeneficiary(item) && <div className="escrow-waiting-banner"><Lock size={14}/> Payment 0 locked · waiting for beneficiary evidence</div>}
        {pending.has(item.status) && <div className="escrow-pending-banner"><LoaderCircle className="spin" size={14}/><span><b>{item.status === "deploying" ? "Deploying RefundProtocol" : item.status === "approving" ? "Approving USDC" : item.status === "locking" ? "Locking payment 0" : item.status === "validating" ? "Validating evidence" : item.status === "releasing" ? "Releasing to beneficiary" : "Returning funds"}</b><small>{item.circleTransactionState || "Circle transaction queued"} · safe to leave this tab</small></span><button onClick={() => void handleAction(item, "refresh")} disabled={Boolean(actionBusy)}><RefreshCw size={12}/></button></div>}
        {item.status === "closed" && <div className="escrow-success-banner"><CheckCircle2 size={15}/> AI-approved release confirmed on Arc Testnet</div>}{item.status === "refunded" && <div className="escrow-success-banner"><Unlock size={15}/> Payment 0 returned to the depositor</div>}
      </article>)}</div>}
    </div>

    {showCreateModal && <CreateEscrowModal onClose={() => setShowCreateModal(false)} onCreated={(item) => setEscrows((previous) => [item, ...previous])} walletAddress={walletAddress}/>}
    {activeEscrow && <div className="overlay"><article className="history-proof-modal escrow-inspector"><button className="modal-x" onClick={() => setActiveEscrow(null)}><X size={18}/></button><div className="history-proof-head"><span className="section-tag">CIRCLE REFUND PROTOCOL INSPECTOR</span>{transactionHash(activeEscrow) && <a className="ledger-proof-link" href={`https://testnet.arcscan.app/tx/${transactionHash(activeEscrow)}`} target="_blank" rel="noreferrer"><ExternalLink size={12}/> View Arc tx</a>}</div><h2>{activeEscrow.title}</h2><p>{activeEscrow.specs}</p><div className="history-proof-summary"><span><small>STATUS</small><b className={activeEscrow.status}>{activeEscrow.status.toUpperCase()}</b></span><span><small>AMOUNT</small><b>{displayMoney(activeEscrow.amount)} USDC</b></span><span><small>PAYMENT ID</small><b>{activeEscrow.paymentId ?? 0}</b></span></div><div className="escrow-protocol-details"><span><small>REFUNDPROTOCOL</small><code>{activeEscrow.contractAddress || "Deploy pending"}</code></span><span><small>DEPOSITOR CIRCLE WALLET</small><code>{activeEscrow.depositorCircleWalletAddress || "Provision pending"}</code></span><span><small>BENEFICIARY CIRCLE WALLET</small><code>{activeEscrow.beneficiaryCircleWalletAddress || "Provision pending"}</code></span></div><div className="escrow-audit-logs"><small className="section-tag">PROTOCOL AUDIT TRAIL</small>{activeEscrow.aiVerificationLogs.map((log, index) => <div key={`${log}-${index}`} className="audit-log-line"><Bot size={12}/><span>{log}</span></div>)}</div>{activeEscrow.deliverableProof && <div className="escrow-proof-box"><small>DELIVERABLE PROOF</small><code>{activeEscrow.deliverableProof}</code></div>}{activeEscrow.validationResult && <div className={`escrow-validation-result ${activeEscrow.validationResult.valid ? "valid" : "invalid"}`}><small>VISION VALIDATION · {activeEscrow.validationResult.confidence}</small><b>{activeEscrow.validationResult.valid ? "Criteria satisfied" : "Evidence rejected"}</b><p>{activeEscrow.validationResult.reasons.join(" · ") || "No unmet criteria reported."}</p><code>sha256:{activeEscrow.validationResult.fileHash}</code></div>}</article></div>}
  </section>;
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
  const [userModalCopied, setUserModalCopied] = useState(false);
  const [selectedProofEntry, setSelectedProofEntry] = useState<LedgerEntry | null>(null);

  function disconnectSolanaWallet() {
    solanaAdapterRef.current = null;
    setSolanaAddress("");
    setSolanaWalletName("");
    setSolanaUsdcBalance(null);
    setSolanaError("");
  }

  const [gatewayError, setGatewayError] = useState("");
  const [gatewayStale, setGatewayStale] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showFunding, setShowFunding] = useState(false);
  const [depositChain, setDepositChain] = useState<SourceChain>("Base_Sepolia");
  const [depositAmount, setDepositAmount] = useState("10.00");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [depositNotice, setDepositNotice] = useState<DepositNotice | null>(null);
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
  const [circleMintBalance, setCircleMintBalance] = useState<{ availableUsd: string; unallocatedUsd: string } | null>(null);
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
  const providerRef = useRef<BrowserWallet["provider"] | null>(null);
  const adapterRef = useRef<BrowserViemAdapter | null>(null);
  const solanaAdapterRef = useRef<BrowserSolanaAdapter | null>(null);
  const clientRef = useRef<ArcPayrollClient | null>(null);
  const unsubscribeProgressRef = useRef<(() => void) | null>(null);
  const unsubscribeChainRef = useRef<(() => void) | null>(null);
  const depositPollRef = useRef(0);
  const cctpRunsRef = useRef(new Map<string, { burnCaptured: boolean }>());
  const activeCctpFormRef = useRef<string | null>(null);
  const knownCctpInvoicesRef = useRef(new Set<string>());
  const autoReconnectAttemptedRef = useRef(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const hasLiveSession = paymentSessionsList.some((session) => session.status === "open" || session.status === "ready");
  const hasPendingCctp = cctpOperations.some((operation) => operation.status !== "confirmed" && operation.status !== "failed");
  const hasPendingFiat = fiatPayouts.some((payout) => payout.status === "submitted" || payout.status === "pending");

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
    depositPollRef.current += 1;
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
    if (!user) return;
    const sync = () => {
      if (document.hidden) return;
      void refreshFiatPayouts();
      void refreshPaymentSessions();
    };
    sync();
    const interval = window.setInterval(sync, hasLiveSession || hasPendingFiat ? 15_000 : 45_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user, hasLiveSession, hasPendingFiat]);
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
  const fiatBalance = null;
  const canReview = fundingMethod === "fiat_bank"
    ? Boolean(recipientAddress && Number(amount) > 0 && fiatBalance !== null && Number(amount) <= Number(fiatBalance))
    : Boolean(displayWalletAddress && chainReady && recipientAddress && Number(amount) > 0 && (!requiresSolanaWallet || solanaAddress));
  const available = fundingMethod === "arc_wallet" ? arcBalance : fundingMethod === "unified_balance" ? unifiedBalance : fundingMethod === "fiat_bank" ? fiatBalance : null;
  const insufficientBalance = available !== null && Number(amount) > Number(available);
  const reviewBlockReason = fundingMethod === "fiat_bank"
    ? recipientQuery.trim() && !recipientAddress ? "Enter a valid recipient username or address"
      : amount.trim() && !(Number(amount) > 0) ? "Enter an amount greater than zero"
        : amount.trim() && insufficientBalance ? "Amount exceeds your sandbox fiat balance"
          : ""
    : !displayWalletAddress ? "Connect an EVM wallet first"
      : !chainReady ? "Add Arc Testnet first"
        : requiresSolanaWallet && !solanaAddress ? "Connect a Solana wallet for this source"
          : recipientQuery.trim() && !recipientAddress ? "Enter a valid recipient username or 0x address"
            : amount.trim() && !(Number(amount) > 0) ? "Enter an amount greater than zero"
              : amount.trim() && insufficientBalance ? `Amount exceeds your ${fundingMethod === "arc_wallet" ? "Arc wallet" : "confirmed Gateway"} balance`
                : "";
  const paymentIssue = paymentError ? describePaymentIssue(paymentError, bridgeSourceChain, fundingMethod) : null;

  async function refreshGatewayBalance(addressOverride?: string) {
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
    const address = addressOverride ?? walletAddress;
    if (address) writeGatewaySnapshot(address, { confirmed: balances.totalConfirmedBalance, pending: balances.totalPendingBalance ?? "0", chains, savedAt: new Date().toISOString() });
    return balances;
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
      const gatewayResult = await refreshGatewayBalance(currentAddress)
        .then((result) => ({ status: "fulfilled" as const, value: result }))
        .catch((reason) => ({ status: "rejected" as const, reason }));
      if (gatewayResult.status === "rejected") {
        const cached = readGatewaySnapshot(currentAddress);
        if (cached) {
          setUnifiedBalance(cached.confirmed); setPendingBalance(cached.pending); setGatewayChainBalances(cached.chains);
        }
        setGatewayStale(true);
        setGatewayError(cached ? "Live Gateway refresh failed · showing last confirmed read" : "Gateway is temporarily unavailable · retry shortly");
      }
      return;
    }
    const cached = readGatewaySnapshot(currentAddress);
    if (cached) {
      setUnifiedBalance(cached.confirmed);
      setPendingBalance(cached.pending);
      setGatewayChainBalances(cached.chains);
      setGatewayStale(true);
      setGatewayError("Connect your wallet to refresh live Gateway balances");
    } else {
      setUnifiedBalance(null);
      setPendingBalance(null);
      setGatewayChainBalances(null);
      setGatewayStale(true);
      setGatewayError("Connect your wallet to read live Gateway balances");
    }
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
      const statusData = await api<{ realCircleBalance?: { availableUsd: string; unallocatedUsd: string } }>("/api/fiat/status");
      if (statusData.realCircleBalance) {
        setCircleMintBalance(statusData.realCircleBalance);
      }
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
      if (!silent || result.imported > 0) setCctpRecoveryNote(result.imported > 0 ? `Recovered ${result.imported} CCTP ${result.imported === 1 ? "transfer" : "transfers"}; ${result.confirmed} already confirmed on Arc.` : result.unavailableChains.length ? `The public explorer scan is temporarily unavailable for ${result.unavailableChains.map((chain) => CHAIN_LABELS[chain]).join(", ")}. Stored activity is still shown below.` : `Scan complete. No untracked CCTP burns found in ${result.discovered} recent wallet transactions.`);
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

  async function monitorGatewayDeposit(notice: Omit<DepositNotice, "state" | "detail">, confirmedBefore: number) {
    const pollId = ++depositPollRef.current;
    const expectedConfirmed = confirmedBefore + Number(notice.amount);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (pollId !== depositPollRef.current) return;
      try {
        const balances = await refreshGatewayBalance();
        const confirmed = Number(balances.totalConfirmedBalance);
        const pending = Number(balances.totalPendingBalance ?? 0);
        if (confirmed + 0.000001 >= expectedConfirmed) {
          setDepositNotice({ ...notice, state: "confirmed", detail: "Confirmed and ready to spend from your unified balance." });
          return;
        }
        setDepositNotice({
          ...notice,
          state: pending > 0 ? "pending" : "submitted",
          detail: pending > 0
            ? `${displayMoney(pending)} USDC is indexing in Circle Gateway.`
            : "Transaction confirmed on the source chain. Waiting for Gateway indexing.",
        });
      } catch (error) {
        setGatewayError(error instanceof Error ? error.message : "Gateway balance refresh failed");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
    if (pollId === depositPollRef.current) {
      setDepositNotice({ ...notice, state: "pending", detail: "Gateway is still indexing this deposit. The transaction is safe to verify in the explorer; refresh again shortly." });
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
      const cachedGateway = readGatewaySnapshot(address);
      if (cachedGateway) {
        setUnifiedBalance(cachedGateway.confirmed);
        setPendingBalance(cachedGateway.pending);
        setGatewayChainBalances(cachedGateway.chains);
        setGatewayStale(true);
      }
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
      }
      if (!(Number(depositAmount) > 0)) throw new Error("Enter an amount greater than zero");
      let confirmedBefore = Number(unifiedBalance ?? 0);
      try {
        const before = await refreshGatewayBalance();
        confirmedBefore = Number(before.totalConfirmedBalance);
      } catch {
        // A temporary read failure should not block a valid wallet deposit.
      }
      const result = await client.deposit(adapter, depositChain, depositAmount);
      const notice = {
        amount: result.amount,
        chain: String(result.chain),
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        createdAt: new Date().toISOString(),
      };
      setDepositNotice({ ...notice, state: "submitted", detail: "Source-chain transaction submitted. Waiting for Circle Gateway indexing." });
      setShowFunding(false);
      void loadBalances();
      void monitorGatewayDeposit(notice, confirmedBefore);
    } catch (error) { setDepositError(error instanceof Error ? error.message : "Gateway deposit failed"); }
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
        setPaymentEstimate({ title: "Sandbox fiat transfer", detail: "OffGrid will debit your sandbox fiat balance and credit the recipient immediately.", fees: "Sandbox ledger only · no chain fee" });
        return;
      }
      if (!recipientAddress || !user) throw new Error("Please select or enter a recipient address");
      const { client, adapter } = await ensureClientAndAdapter();
      if (fundingMethod === "arc_wallet") {
        await client.estimateArcSend(adapter, recipientAddress, amount);
        setPaymentEstimate({ title: "Direct Arc transfer", detail: `${amount} USDC settles directly on Arc Testnet`, fees: "Arc gas is paid in USDC" });
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
        const saved = await api<{ invoice: InvoiceData }>("/api/invoices", { method: "POST", body: JSON.stringify({
          recipientUserId: recipient?.id ?? null,
          recipientAddress,
          recipientLabel: recipient?.displayName ?? shortAddress(recipientAddress),
          amount,
          fundingMethod: "fiat_bank",
          memo,
          paymentSessionToken: activeSessionToken || undefined,
        }) });
        setPaymentPhase("receipt");
        setInvoice(saved.invoice);
        setStep("complete");
        await refreshCurrentUser();
        await loadBalances();
      } catch (error) {
        setPaymentError(error instanceof Error ? error.message : "Fiat sandbox transfer failed");
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

  return (
    <main className="product-shell">
      <header className="product-header">
        <a className="product-brand" href="#top"><Logo /><b>offgrid</b><span>ARC TESTNET</span></a>
        <div className="header-signal"><i /> NETWORK OPERATIONAL <em>{ARC.finalityMs}ms FINALITY</em></div>
        <div className="header-actions">
          {displayWalletAddress && !walletOnArc && <button className="arc-switch-button" onClick={switchToArc} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="spin" size={12} /> : <Network size={12} />} Switch to Arc</button>}
          
          <button className="faucet-button onramp-header-btn" onClick={() => setShowOnRamp(true)}><CreditCard size={15} /> Buy USDC (On-Ramp)</button>
          <a className="faucet-button" href="https://faucet.circle.com/" target="_blank" rel="noreferrer"><Fuel size={15} /> Get test USDC <ExternalLink size={12} /></a>

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
                  <span>{solanaAddress ? `Solana: ${shortAddress(solanaAddress, 4)}` : "Connect Solana wallet"}</span>
                  {solanaAddress && <small>{solanaUsdcBalance === null ? "" : `${displayMoney(solanaUsdcBalance)} USDC`}</small>}
                </button>
                <div className="menu-divider" />
                <button onClick={() => { setShowWalletMenu(false); void loadBalances(); }}><RefreshCw size={12} /> Refresh balances</button>
                <button onClick={() => { void disconnectWallet(); }}><LogOut size={12} /> Disconnect wallet</button>
              </div>
            </div>
          ) : (
            <button className="connect-wallet" onClick={beginWalletConnection} disabled={walletBusy}>
              {walletBusy ? <LoaderCircle className="spin" size={15} /> : <Wallet size={15} />} Connect wallet
            </button>
          )}

          <ThemeToggle />
          <button className="user-menu" onClick={() => setShowUserModal(true)} title={`Signed in as @${user.username}`}>
            <span className="user-emblem-sm"><User size={14} /></span>
            <ChevronDown size={13} />
          </button>
        </div>
      </header>

      {solanaError && <div className="wallet-error-toast"><ChainLogo chain="Solana_Devnet" size={20}/><span><b>Solana wallet</b><small>{solanaError}</small></span><button onClick={() => setSolanaError("")} aria-label="Dismiss Solana wallet error"><X size={13}/></button></div>}

      <div className="product-grid" id="top">
        <aside className="command-rail">
          <div className="rail-user"><span className="user-emblem"><User size={16} /></span><div><b>{user.displayName}</b><small>@{user.username}</small></div><BadgeCheck size={16} /></div>
          <nav><button className={activeView === "transfer" ? "active" : ""} onClick={() => setActiveView("transfer")}><Send size={17} /> Transfer</button><button className={activeView === "history" ? "active" : ""} onClick={() => setActiveView("history")}><Receipt size={17} /> History {displayWalletAddress && <span>{activity.length + fiatPayouts.length + cctpOperations.filter((operation) => !operation.invoiceId && isSubmittedCctpOperation(operation)).length + (depositNotice ? 1 : 0)}</span>}</button><button className={activeView === "unified" ? "active" : ""} onClick={() => { setActiveView("unified"); void loadBalances(); }}><Network size={17} /> Unified Balance</button><button className={activeView === "mass" ? "active" : ""} onClick={() => setActiveView("mass")}><UserRound size={17} /> Mass Payment</button><button className={activeView === "escrow" ? "active" : ""} onClick={() => setActiveView("escrow")}><Scale size={17} /> AI Escrow</button><button className={activeView === "agents" ? "active" : ""} onClick={() => setActiveView("agents")}><Sparkles size={17} /> Agent Payments <span className="soon-badge">SOON</span></button></nav>
          <div className="rail-flow"><small>LIVE PAYMENT STACK</small><div><span>01</span><p><b>IDENTITY</b><em>Authenticated</em></p><Check size={13} /></div><i /><div><span>02</span><p><b>WALLET</b><em>{displayWalletAddress ? "Connected" : "Waiting"}</em></p>{displayWalletAddress ? <Check size={13} /> : <Radio size={13} />}</div><i /><div><span>03</span><p><b>NETWORK</b><em>{walletOnArc ? "Arc active" : chainReady ? "Switch to Arc" : "Not configured"}</em></p>{walletOnArc ? <Check size={13} /> : <Radio size={13} />}</div><i /><div><span>04</span><p><b>SETTLEMENT</b><em>App Kit</em></p><Zap size={13} /></div></div>
          <button className="logout-button" onClick={logout}><LogOut size={15} /> Sign out</button>
        </aside>

        <section className="product-main">
          <NeonMesh opacity={0.22} />
          {activeView === "transfer" ? <div className="transfer-view">
          {displayWalletAddress && <section className="session-launchpad">
            <div className="session-launch-glow" />
            <div className="session-launch-icon"><LockKeyhole size={24} /><i /></div>
            <div className="session-launch-copy"><span><Sparkles size={11} /> START HERE · PRIVATE PAYMENT</span><h2>Open a payment session.</h2><p>Set the direction and amount, share one secure link, then let both sides choose how money moves.</p><div className="session-launch-flow"><span><i>1</i>Set terms</span><b /><span><i>2</i>Share privately</span><b /><span><i>3</i>Settle together</span></div></div>
            <div className="session-launch-column">
              <button className="session-launch-button" onClick={() => { setCreatedSessionLink(""); setSessionError(""); setSessionLinkCopied(false); setShowSessionCreator(true); }}><span><Plus size={18} /></span><div><small>NEW SECURE FLOW</small><b>Create payment session</b></div><ArrowRight size={18} /></button>
              <button type="button" className="live-sessions-text-link" onClick={() => { setSessionError(""); setShowLiveSessionsModal(true); void refreshPaymentSessions(); }}>
                <Radio size={12} className="spin-slow" />
                <span>View active payment sessions ({paymentSessionsList.filter((session) => session.status === "open" || session.status === "ready").length})</span>
                <ArrowRight size={12} />
              </button>
            </div>
          </section>}
          <div className="workspace-head"><span><Radio size={11} /> LIVE COMMAND CENTER</span><h1>Move money.<br /><em>Not complexity.</em></h1><p>Agree on both rails, then execute real settlement.</p></div>

          {!displayWalletAddress ? (
            <section className="onboarding-card">
              <div className="onboarding-art"><div className="wallet-core"><Wallet size={30} /></div><i /><i /><i /><span>01</span><span>02</span><span>03</span></div>
              <div><span className="section-tag">STEP 01 · WALLET ACCESS</span><h2>Connect the wallets you control.</h2><p>Your EVM wallet is the Arc account and destination signer. Add a Solana wallet whenever you want to deposit, bridge, or spend Solana Devnet USDC through Circle.</p><div className="onboarding-wallet-actions"><button className="neon-button" onClick={beginWalletConnection} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />} Connect EVM wallet <ArrowRight size={16} /></button><button className="solana-onboarding-button" onClick={() => void beginSolanaConnection()} disabled={solanaBusy}><ChainLogo chain="Solana_Devnet" size={20}/>{solanaBusy ? "Opening wallet…" : solanaAddress ? `${shortAddress(solanaAddress, 5)} connected` : "Connect Solana"}</button></div>{walletError && <p className="inline-error"><CircleAlert size={13} />{walletError}</p>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}</div>
            </section>
          ) : (
            <>
              <section className="real-balances">
                <div className="balance-intro"><span className="section-tag">REAL TESTNET BALANCES</span><h2>Your money, live.</h2><p>Read directly from Arc and Circle Gateway. No demo numbers.</p></div>
                <article className="real-balance primary"><div><span className="balance-icon"><ChainLogo chain="Arc_Testnet" size={25}/></span><small>ARC WALLET</small><button onClick={() => loadBalances()} aria-label="Refresh balances"><RefreshCw size={13} /></button></div><b>{arcBalance === null ? "—" : displayMoney(arcBalance)} <em>USDC</em></b><p className={balanceError ? "balance-read-error" : ""} title={balanceError || undefined}>{balanceError ? "Arc RPC unavailable · retry" : shortAddress(displayWalletAddress)}</p></article>
                <article className="real-balance"><div><span className="balance-icon gateway"><Network size={16} /></span><small>UNIFIED BALANCE</small><button onClick={() => loadBalances()} aria-label="Refresh balances"><RefreshCw size={13} /></button></div><b>{unifiedBalance === null ? "—" : displayMoney(unifiedBalance)} <em>USDC</em></b><p className={gatewayError ? "balance-read-error" : ""} title={gatewayError || undefined}>{gatewayError || (pendingBalance && Number(pendingBalance) > 0 ? `${displayMoney(pendingBalance)} USDC pending` : "Circle Gateway · confirmed")}</p><button className="deposit-link" onClick={() => { setDepositError(""); setShowFunding(true); }}><Plus size={12} /> Deposit</button></article>
                <article className="real-balance fiat"><div><span className="balance-icon fiat"><Banknote size={16} /></span><small>TOTAL FIAT VOLUME</small><button onClick={() => { void refreshFiatPayouts(); }} aria-label="Refresh fiat volume"><RefreshCw size={13} /></button></div><b>{displayMoney(fiatPayouts.filter((entry) => entry.ownerId === user.id).reduce((acc, entry) => acc + (Number(entry.amount) || 0), 0))} <em>USD</em></b><p>{`Total fiat wired via Circle Mint · ${fiatPayouts.filter((entry) => entry.ownerId === user.id).length} payout transactions`}</p></article>
              </section>

              {depositNotice && <section className={`gateway-status ${depositNotice.state}`}>
                <span className="gateway-status-icon">{depositNotice.state === "confirmed" ? <CircleCheck size={19} /> : <LoaderCircle className="spin" size={19} />}</span>
                <div><small>GATEWAY DEPOSIT · {depositNotice.state.toUpperCase()}</small><b>{displayMoney(depositNotice.amount)} USDC from {SOURCE_CHAINS.includes(depositNotice.chain as SourceChain) ? <ChainName chain={depositNotice.chain as SourceChain} size={17}/> : depositNotice.chain}</b><p>{depositNotice.detail}</p></div>
                <div className="gateway-status-actions">{depositNotice.explorerUrl && <a href={depositNotice.explorerUrl} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a>}<button onClick={() => loadBalances()}><RefreshCw size={12} /> Refresh</button></div>
                <button className="gateway-status-close" onClick={() => { depositPollRef.current += 1; setDepositNotice(null); }} aria-label="Dismiss deposit status"><X size={13} /></button>
              </section>}

              <section className="pay-console">
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
                    <div className="available-line"><span>{fundingMethod === "cctp_bridge" ? <><b>Source-chain USDC</b> · validated by App Kit</> : fundingMethod === "fiat_bank" ? <><b>Circle Mint balance</b> · provider credentials required</> : available === null ? <><b>Balance not loaded</b> · App Kit will validate</> : <>Available: <b>{displayMoney(available)} USDC</b></>}</span>{fundingMethod !== "cctp_bridge" && <button onClick={() => { if (available) setAmount(available); setGatewayMintRetry(null); setPaymentEstimate(null); }}>MAX</button>}</div>

                    <label className="field-label"><span>03</span> FUND FROM</label>
                    <div className="funding-options">
                      <button className={fundingMethod === "arc_wallet" ? "active" : ""} onClick={() => { setFundingMethod("arc_wallet"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Wallet size={16} /><span><b>Arc wallet</b><small>Direct App Kit send</small></span>{fundingMethod === "arc_wallet" && <Check size={14} />}</button>
                      <button className={fundingMethod === "unified_balance" ? "active" : ""} onClick={() => { setFundingMethod("unified_balance"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Network size={16} /><span><b>Unified balance</b><small>Gateway auto-allocation</small></span>{fundingMethod === "unified_balance" && <Check size={14} />}</button>
                      <button className={fundingMethod === "cctp_bridge" ? "active" : ""} onClick={() => { setFundingMethod("cctp_bridge"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Blocks size={16} /><span><b>CCTP bridge</b><small>Cross-chain to Arc</small></span>{fundingMethod === "cctp_bridge" && <Check size={14} />}</button>
                      <button className={fundingMethod === "fiat_bank" ? "active" : ""} onClick={() => { setFundingMethod("fiat_bank"); setPaymentEstimate(null); setGatewayMintRetry(null); }}><Banknote size={16} /><span><b>Sandbox fiat</b><small>Local balance transfer</small></span>{fundingMethod === "fiat_bank" && <Check size={14} />}</button>
                    </div>
                    {fundingMethod === "cctp_bridge" && <><div className="cctp-config"><div className="cctp-source-card"><span className="cctp-card-label">SOURCE CHAIN</span><ChainSelect className="cctp-chain-select" value={bridgeSourceChain} chains={CCTP_SOURCE_CHAINS} eyebrow="PAY FROM" onChange={(chain) => { setBridgeSourceChain(chain as CctpSourceChain); setPaymentEstimate(null); }} /><p>USDC balance and native source-chain gas required.</p></div><div className="cctp-route-card"><div className="cctp-protocol-head"><span><Blocks size={15} /></span><div><small>BRIDGE PROTOCOL</small><b>CCTP V2</b></div><em>FORWARDED</em></div><div className="cctp-mini-route"><ChainName chain={bridgeSourceChain} size={15}/><i><ArrowRight size={12} /></i><ChainName chain="Arc_Testnet" size={15}/></div><p><Check size={11} /> Circle Forwarder <i /> fee shown in estimate</p></div></div>{bridgeSourceChain === "Solana_Devnet" && <div className={`solana-source ${solanaAddress ? "connected" : ""}`}><span><ChainLogo chain="Solana_Devnet" size={22}/></span><div><b>{solanaAddress ? `${solanaWalletName} connected` : "Solana signer required"}</b><small>{solanaAddress ? `${shortAddress(solanaAddress, 6)} · ${solanaUsdcBalance === null ? "balance unavailable" : `${displayMoney(solanaUsdcBalance)} USDC`}` : "Phantom · Solflare · Backpack"}</small></div>{solanaAddress ? <Check size={15} /> : <button onClick={() => void beginSolanaConnection()} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={13} /> : "Connect"}</button>}</div>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}</>}

                    <label className="field-label optional"><span>04</span> MEMO <em>OPTIONAL</em></label>
                    <input className="memo-input" value={memo} readOnly={Boolean(activeSession)} onChange={(event) => setMemo(event.target.value)} maxLength={180} placeholder="What is this payment for?" />
                  </div>

                  <aside className="route-panel">
                    <span className="section-tag">LIVE ROUTE</span><h3>Settlement path</h3>
                    <div className="route-node ready"><span className={fundingMethod === "cctp_bridge" || fundingMethod === "arc_wallet" || fundingMethod === "fiat_bank" ? "chain-logo-only" : ""}>{fundingMethod === "cctp_bridge" ? <ChainLogo chain={bridgeSourceChain} size={24}/> : fundingMethod === "arc_wallet" ? <ChainLogo chain="Arc_Testnet" size={24}/> : fundingMethod === "fiat_bank" ? <Banknote size={16} /> : <Network size={16} />}</span><div><small>SOURCE</small><b>{fundingMethod === "arc_wallet" ? "Arc wallet" : fundingMethod === "unified_balance" ? "Gateway balance" : fundingMethod === "fiat_bank" ? "Sandbox fiat balance" : CHAIN_LABELS[bridgeSourceChain]}</b><em>{fundingMethod === "cctp_bridge" ? "Connected source signer" : fundingMethod === "fiat_bank" ? `OffGrid sandbox ledger · ${available === null ? "balance loading" : `${displayMoney(available)} USD available`}` : available === null ? "Balance loading" : `${displayMoney(available)} USDC available`}</em></div><Check size={14} /></div>
                    <i className="route-line"><b /></i>
                    <div className="route-node arc"><span>{fundingMethod === "cctp_bridge" ? <Blocks size={16} /> : fundingMethod === "fiat_bank" ? <Banknote size={16} /> : <ChainLogo chain="Arc_Testnet" size={24}/>}</span><div><small>SETTLEMENT</small><b>{fundingMethod === "cctp_bridge" ? "Circle CCTP V2" : fundingMethod === "fiat_bank" ? "Sandbox fiat transfer" : "Arc Testnet"}</b><em>{fundingMethod === "cctp_bridge" ? "Burn · attest · Forwarder mint" : fundingMethod === "fiat_bank" ? "Debit · credit · receipt" : "Deterministic finality"}</em></div><Zap size={14} /></div>
                    <i className="route-line"><b /></i>
                    <div className={`route-node ${recipientAddress ? "ready" : "waiting"}`}><span><UserRound size={16} /></span><div><small>DESTINATION</small><b>{recipient?.displayName ?? (recipientAddress ? "External wallet" : "Waiting for recipient")}</b><em>{recipientAddress ? shortAddress(recipientAddress) : "Enter a username or address"}</em></div>{recipientAddress ? <Check size={14} /> : <Radio size={14} />}</div>
                    <dl><div><dt>Asset</dt><dd>{fundingMethod === "fiat_bank" ? "USD" : "USDC"}</dd></div><div><dt>Protocol</dt><dd>{fundingMethod === "cctp_bridge" ? "CCTP V2" : fundingMethod === "unified_balance" ? "Gateway" : fundingMethod === "fiat_bank" ? "Sandbox fiat" : "App Kit send"}</dd></div><div><dt>Destination</dt><dd>{fundingMethod === "fiat_bank" ? "OffGrid sandbox ledger" : "Arc Testnet"}</dd></div><div><dt>Signing</dt><dd>{fundingMethod === "fiat_bank" ? "App auth" : "Your wallet"}</dd></div></dl>
                    {paymentIssue && <div className="payment-issue" role="alert"><span><CircleAlert size={15} /></span><div><b>{paymentIssue.title}</b><p>{paymentIssue.detail}</p></div><div className="payment-issue-actions">{fundingMethod === "cctp_bridge" && <button type="button" onClick={useGatewayFallback}><Network size={12} /> Use Gateway</button>}{paymentIssue.retryable && step === "review" && (gatewayMintRetry ? <button type="button" disabled={gatewayMintBusy} onClick={() => void retryGatewayMint()}><RefreshCw className={gatewayMintBusy ? "spin" : ""} size={12} /> {gatewayMintBusy ? "Recovering Arc mint…" : "Retry Arc mint"}</button> : <button type="button" disabled={estimateBusy} onClick={() => { setPaymentError(""); setPaymentEstimate(null); void estimatePayment(); }}><RefreshCw className={estimateBusy ? "spin" : ""} size={12} /> {fundingMethod === "cctp_bridge" ? "Retry CCTP" : fundingMethod === "unified_balance" ? "Retry Gateway" : "Retry route"}</button>)}</div></div>}
                    {step === "review" ? <>
                      {paymentEstimate && <div className="route-estimate"><span><CircleCheck size={14} /></span><div><b>{paymentEstimate.title}</b><small>{paymentEstimate.detail}</small><em>{paymentEstimate.fees}</em></div></div>}
                      <button className={`neon-button pay-now ${estimateBusy || gatewayMintBusy ? "is-loading" : ""}`} onClick={gatewayMintRetry ? retryGatewayMint : paymentEstimate ? pay : estimatePayment} disabled={estimateBusy || gatewayMintBusy}><span className="pay-now-leading">{estimateBusy || gatewayMintBusy ? <LoaderCircle className="spin" size={17} /> : gatewayMintRetry ? <RefreshCw size={17} /> : paymentEstimate ? <Zap size={17} /> : <Network size={17} />}</span><span className="pay-now-label">{estimateBusy ? fundingMethod === "fiat_bank" ? "Checking sandbox balance…" : "Checking live route…" : gatewayMintBusy ? "Recovering Arc mint…" : gatewayMintRetry ? "Retry Arc mint" : paymentEstimate ? fundingMethod === "fiat_bank" ? "Confirm sandbox transfer" : "Confirm in wallet" : "Get live estimate"}</span><ArrowRight size={16} /></button>
                    </> : step === "processing" ? <><div className="protocol-progress">{(fundingMethod === "fiat_bank" ? [["estimate","Sandbox balance"],["settlement","Ledger transfer"],["receipt","Updated balances"]] : [["estimate","Live estimate"],["signature","Wallet signature"],["settlement",fundingMethod === "cctp_bridge" ? "CCTP lifecycle" : "Arc finality"],["receipt","Create receipt"]]).map(([phase,label], index, phases) => { const current = phases.findIndex(([name]) => name === paymentPhase); return <span key={phase} className={index <= current ? "active" : ""}><i>{index < current ? <Check size={9} /> : index + 1}</i>{label}</span>; })}</div>{protocolEvents.length > 0 && <div className="protocol-stream">{protocolEvents.map((event) => <span className={event.state} key={event.name}><i />{event.name}<b>{event.state}</b></span>)}</div>}<button className="neon-button pay-now is-loading" disabled><span className="pay-now-leading"><LoaderCircle className="spin" size={17} /></span><span className="pay-now-label">{paymentPhase === "estimate" ? fundingMethod === "fiat_bank" ? "Checking sandbox balance…" : "Estimating with App Kit…" : paymentPhase === "signature" ? "Confirm in your wallet…" : paymentPhase === "settlement" ? fundingMethod === "fiat_bank" ? "Updating sandbox balances…" : fundingMethod === "cctp_bridge" ? "Burning, attesting & minting…" : "Waiting for Arc finality…" : "Creating verified receipt…"}</span><span className="pay-now-end" /></button></> : <><button className="neon-button pay-now" disabled={!canReview || insufficientBalance} onClick={() => { setPaymentEstimate(null); setPaymentError(""); setStep("review"); }}><span className="pay-now-leading"><Send size={17} /></span><span className="pay-now-label">{fundingMethod === "fiat_bank" ? "Review sandbox transfer" : "Review payment"}</span><ArrowRight size={16} /></button>{reviewBlockReason && <p className="review-blocker"><CircleAlert size={11} /> {reviewBlockReason}</p>}{available === null && canReview && fundingMethod !== "fiat_bank" && <p className="review-warning"><Radio size={11} /> {fundingMethod === "cctp_bridge" ? "App Kit validates source USDC and gas before CCTP execution." : "Balance unavailable in UI; App Kit will check it during estimation."}</p>}</>}
                    <p className="self-custody"><ShieldCheck size={12} /> OffGrid never holds your keys or signs for you.</p>
                    <button className="view-all-activity" onClick={() => setActiveView("history")}>View all activities <ArrowRight size={12} /></button>
                  </aside>
                </div>
              </section>
            </>
          )}
          </div> : activeView === "history" ? walletAddress ? <HistoryView invoices={activity} deposit={depositNotice} cctpOperations={cctpOperations} fiatPayouts={fiatPayouts} recovering={cctpRecovering} recoveryNote={cctpRecoveryNote} onRecover={() => void recoverCctpOperations()} onRefreshCctp={() => void refreshCctpOperations()} onRefreshFiat={() => void refreshFiatPayouts()} onSelectEntry={setSelectedProofEntry} /> : <div className="unified-empty"><Receipt size={30} /><h2>Connect a wallet to view history.</h2><p>Transaction activity and receipts stay hidden until your wallet is connected.</p><button className="neon-button" onClick={beginWalletConnection}><Wallet size={15} /> Connect wallet</button></div> : activeView === "unified" ? <UnifiedBalanceView walletAddress={walletAddress} walletOnArc={walletOnArc} arcBalance={arcBalance} unifiedBalance={unifiedBalance} pendingBalance={pendingBalance} chainBalances={gatewayChainBalances} gatewayError={gatewayError} gatewayStale={gatewayStale} solanaAddress={solanaAddress} solanaWalletName={solanaWalletName} solanaUsdcBalance={solanaUsdcBalance} solanaBusy={solanaBusy} onRefresh={() => loadBalances()} onDeposit={() => { setDepositError(""); setShowFunding(true); }} onConnect={beginWalletConnection} onConnectSolana={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} /> : activeView === "mass" ? <MassPaymentView walletAddress={walletAddress} directBalance={arcBalance} unifiedBalance={unifiedBalance} onConnect={beginWalletConnection} onExecute={executeMassPayroll} /> : activeView === "escrow" ? <EscrowView walletAddress={displayWalletAddress} arcBalance={arcBalance} onConnect={beginWalletConnection} onRefresh={() => loadBalances()} /> : <section className="agent-soon-view"><div className="agent-orbit"><Sparkles size={27} /><i /><i /><i /></div><span className="section-tag">AUTONOMOUS SETTLEMENT · SOON</span><h1>Agent Payments</h1><p>Policy-controlled wallets, programmable limits, approvals, and auditable payments initiated by trusted agents.</p><div className="agent-soon-grid"><span><ShieldCheck size={16} /><b>Policy engine</b><small>Limits, allowlists, and human approval gates</small></span><span><Network size={16} /><b>Any-to-any rails</b><small>Arc, Gateway, CCTP, and fiat routing</small></span><span><Receipt size={16} /><b>Agent audit trail</b><small>Intent, reasoning reference, and transaction proof</small></span></div><em>IN DEVELOPMENT</em></section>}
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
                <small><ChainLogo chain="Arc_Testnet" size={14}/> ARC WALLET</small>
                <b>{arcBalance === null ? "—" : displayMoney(arcBalance)} <em>USDC</em></b>
              </div>
              <div className="modal-stat-chip">
                <small><Network size={13}/> UNIFIED</small>
                <b>{unifiedBalance === null ? "—" : displayMoney(unifiedBalance)} <em>USDC</em></b>
              </div>
              <div className="modal-stat-chip">
                <small><Banknote size={13}/> FIAT</small>
                <b>{circleMintBalance ? `$${displayMoney(circleMintBalance.availableUsd)}` : "—"} <em>USD</em></b>
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
              <div className="user-actions-row">
                <div className="user-action-card fund" role="status">
                  <div className="action-card-icon"><Banknote size={16} /></div>
                  <div className="action-card-text">
                    <b>Circle Mint balance</b>
                    <small>{circleMintBalance ? `$${displayMoney(circleMintBalance.availableUsd)} available` : "Provider status unavailable"}</small>
                  </div>
                </div>

                <button className="user-action-card share" onClick={() => {
                  const inviteUrl = `${window.location.origin}/?invite=${user.id}`;
                  navigator.clipboard.writeText(inviteUrl);
                  setUserModalCopied(true);
                  setTimeout(() => setUserModalCopied(false), 2000);
                }}>
                  <div className="action-card-icon"><Share2 size={15} /></div>
                  <div className="action-card-text">
                    <b>{userModalCopied ? "Copied!" : "Share Link"}</b>
                    <small>{userModalCopied ? "Link in clipboard" : "Copy session URL"}</small>
                  </div>
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0", padding: "10px 12px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px" }}>
                <span style={{ font: "11px var(--mono)", color: "var(--muted)", fontWeight: 600 }}>INTERFACE THEME</span>
                <ThemeToggle />
              </div>

              <button className="user-logout-btn" onClick={() => { setShowUserModal(false); void logout(); }}>
                <LogOut size={14} /> Sign out of account
              </button>

              <div className="user-modal-version-footer" style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ font: "9px var(--mono)", color: "var(--muted)", letterSpacing: ".06em" }}>OFFGRID PROTOCOL RELEASE</span>
                <span style={{ font: "10px var(--mono)", color: "var(--acid)", fontWeight: 700 }}>v0.3.0-ARC · BUILD 1564B82</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWallets && <div className="overlay"><article className="wallet-picker"><button className="modal-x" onClick={() => setShowWallets(false)}><X size={18} /></button><span className="section-tag">SELECT SIGNER</span><h2>Choose your wallet</h2><p>OffGrid found these EIP-6963 providers in your browser.</p>{wallets.map((wallet) => <button className="wallet-choice" key={wallet.info.uuid} onClick={() => connectWallet(wallet)}>{wallet.info.icon ? <img src={wallet.info.icon} alt="" /> : <Wallet size={21} />}<span><b>{wallet.info.name}</b><small>{wallet.info.rdns}</small></span><ArrowRight size={16} /></button>)}</article></div>}

      {showSolanaWallets && <div className="overlay"><article className="wallet-picker solana-wallet-picker"><button className="modal-x" onClick={() => setShowSolanaWallets(false)}><X size={18} /></button><span className="section-tag">SOLANA DEVNET SIGNER</span><h2>Choose your Solana wallet</h2><p>This signer can deposit USDC into Circle Gateway, fund unified payments, and bridge directly to Arc through CCTP.</p>{solanaWallets.map((wallet) => <button className="wallet-choice" key={wallet.id} onClick={() => void connectSolanaSource(wallet)}><ChainLogo chain="Solana_Devnet" size={27}/><span><b>{wallet.name}</b><small>SOLANA DEVNET · SELF-CUSTODY</small></span><ArrowRight size={16} /></button>)}</article></div>}

      {showSessionCreator && <div className="overlay"><article className="session-create-modal"><button className="modal-x" onClick={() => setShowSessionCreator(false)}><X size={18} /></button><span className="section-tag">PRIVATE PAYMENT SESSION</span>{createdSessionLink ? <><h2>Your payment window is live.</h2><p>Send this capability link to exactly one person. The first authenticated account to accept becomes the counterparty.</p><div className="created-session-link"><LockKeyhole size={15} /><span>{createdSessionLink}</span></div><button className="neon-button" onClick={copyCreatedSession}><Copy size={15} />{sessionLinkCopied ? "Link copied" : "Copy secure link"}</button><a className="open-session-link" href={createdSessionLink}>Open payment window <ExternalLink size={12} /></a></> : <><h2>Who moves the money?</h2><p>Set immutable starting terms. The other participant chooses their own rail after opening the link.</p><label>Your role<div className="intent-options"><button className={sessionIntent === "pay" ? "active" : ""} onClick={() => setSessionIntent("pay")}><ArrowUpRight size={15} /><span><b>I want to pay</b><small>The invitee receives</small></span>{sessionIntent === "pay" && <Check size={14} />}</button><button className={sessionIntent === "receive" ? "active" : ""} onClick={() => setSessionIntent("receive")}><ArrowDownToLine size={15} /><span><b>I want to receive</b><small>The invitee pays</small></span>{sessionIntent === "receive" && <Check size={14} />}</button></div></label><label>Your preferred rail<div className="intent-options"><button className={sessionRail === "web3_usdc" ? "active" : ""} onClick={() => setSessionRail("web3_usdc")}><Wallet size={15} /><span><b>Web3 USDC</b><small>Arc · Gateway · CCTP</small></span>{sessionRail === "web3_usdc" && <Check size={14} />}</button><button className={sessionRail === "fiat_bank" ? "active" : ""} onClick={() => setSessionRail("fiat_bank")}><Banknote size={15} /><span><b>Bank / fiat</b><small>Sandbox setup required</small></span>{sessionRail === "fiat_bank" && <Check size={14} />}</button></div></label><label>Amount<div className="fund-amount"><input value={sessionAmount} onChange={(event) => setSessionAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /><span>USDC / USD</span></div></label><label>Memo <em>OPTIONAL</em><input className="session-memo-input" value={sessionMemo} onChange={(event) => setSessionMemo(event.target.value)} maxLength={180} placeholder="August payroll, design retainer…" /></label>{sessionError && <p className="inline-error"><CircleAlert size={13} />{sessionError}</p>}<button className="neon-button" onClick={createPaymentSession} disabled={sessionBusy}>{sessionBusy ? <LoaderCircle className="spin" size={15} /> : <LockKeyhole size={15} />} Create immutable session</button></>}</article></div>}

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
                    <p>Arc acts as an invisible clearing engine sitting between two completely independent user preferences.</p>
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
                        const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/?session=${sess.inviteTokenHash}`;
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
                                  {sess.payerInputRail === "fiat_bank" ? "Bank Wire (Circle Mint)" : sess.payerInputRail === "web3_usdc" ? "Web3 USDC (Arc)" : "Awaiting Choice"}
                                </b>
                                <span className="card-status">{sess.payerInputRail ? "Choice Locked" : "Pending Selection"}</span>
                              </div>

                              <div className="summary-card">
                                <div className="card-tag">
                                  <Zap size={12} className="zap-pulse" />
                                  ARC CLEARING
                                </div>
                                <b className="card-val">~0.48s Sub-second Finality</b>
                                <span className="card-status">SessionEscrow Contract</span>
                              </div>

                              <div className="summary-card">
                                <div className="card-tag">
                                  {sess.receiverOutputRail === "fiat_bank" ? <Banknote size={12} /> : <Wallet size={12} />}
                                  RECEIVER OUTPUT
                                </div>
                                <b className="card-val">
                                  {sess.receiverOutputRail === "fiat_bank" ? "Bank Wire (SEPA/ACH)" : sess.receiverOutputRail === "web3_usdc" ? "Web3 USDC (Arc)" : "Awaiting Choice"}
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
                                  <span>3. Arc Clearing (~0.48s)</span>
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
                                <span>{inviteUrl}</span>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <a
                                  href={`/session/${sess.inviteTokenHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="neon-button-sm primary-cta"
                                  style={{ textDecoration: "none" }}
                                >
                                  <ExternalLink size={13} /> Open Session
                                </a>
                                <button
                                  type="button"
                                  className="neon-button-sm secondary-ghost"
                                  onClick={() => {
                                    if (typeof window !== "undefined") {
                                      navigator.clipboard.writeText(inviteUrl);
                                    }
                                  }}
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

      {showFunding && <div className="overlay"><article className="funding-modal"><button className="modal-x" onClick={() => setShowFunding(false)}><X size={18} /></button><span className="section-tag">CIRCLE GATEWAY</span><h2>Fund unified balance</h2><p>Deposit USDC from an EVM testnet or Solana Devnet. App Kit handles authorization and the Gateway deposit.</p><div className="modal-chain-field"><span>Source network</span><ChainSelect value={depositChain} chains={SOURCE_CHAINS} onChange={(chain) => { setDepositChain(chain); setDepositError(""); }} /></div>{depositChain === "Solana_Devnet" && <div className={`solana-deposit-wallet ${solanaAddress ? "connected" : ""}`}><ChainLogo chain="Solana_Devnet" size={25}/><div><small>{solanaAddress ? `${solanaWalletName.toUpperCase()} · SOURCE WALLET` : "SOLANA SIGNER REQUIRED"}</small><b>{solanaAddress ? `${solanaUsdcBalance === null ? "—" : displayMoney(solanaUsdcBalance)} USDC` : "Phantom · Solflare · Backpack"}</b>{solanaAddress && <em>{shortAddress(solanaAddress, 6)}</em>}</div><button onClick={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={13}/> : solanaAddress ? <RefreshCw size={13}/> : <Wallet size={13}/>} {solanaAddress ? "Refresh" : "Connect"}</button></div>}<label>Amount<div className="fund-amount"><input value={depositAmount} onChange={(event) => { setDepositAmount(event.target.value.replace(/[^0-9.]/g, "")); setDepositError(""); }} inputMode="decimal" /><span>USDC</span></div></label><div className="gateway-diagram"><ChainName chain={depositChain} size={20}/><i><ArrowRight size={16} /></i><span>Gateway</span><i><ArrowRight size={16} /></i><span>Unified</span></div><button className="neon-button" onClick={depositToGateway} disabled={depositBusy || !walletAddress || !(Number(depositAmount) > 0) || (depositChain === "Solana_Devnet" && !solanaAddress)}>{depositBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />} {depositBusy ? "Confirm in wallet…" : "Review deposit in wallet"}</button>{depositError && <p className="inline-error"><CircleAlert size={13} />{depositError}</p>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}<small><ShieldCheck size={12} /> Testnet transaction. App Kit switches to the source chain; OffGrid keeps reading Arc independently.</small></article></div>}

      {showFunding && <div className="overlay"><article className="funding-modal"><button className="modal-x" onClick={() => setShowFunding(false)}><X size={18} /></button><span className="section-tag">CIRCLE GATEWAY</span><h2>Fund unified balance</h2><p>Deposit USDC from an EVM testnet or Solana Devnet. App Kit handles authorization and the Gateway deposit.</p><div className="modal-chain-field"><span>Source network</span><ChainSelect value={depositChain} chains={SOURCE_CHAINS} onChange={(chain) => { setDepositChain(chain); setDepositError(""); }} /></div>{depositChain === "Solana_Devnet" && <div className={`solana-deposit-wallet ${solanaAddress ? "connected" : ""}`}><ChainLogo chain="Solana_Devnet" size={25}/><div><small>{solanaAddress ? `${solanaWalletName.toUpperCase()} · SOURCE WALLET` : "SOLANA SIGNER REQUIRED"}</small><b>{solanaAddress ? `${solanaUsdcBalance === null ? "—" : displayMoney(solanaUsdcBalance)} USDC` : "Phantom · Solflare · Backpack"}</b>{solanaAddress && <em>{shortAddress(solanaAddress, 6)}</em>}</div><button onClick={() => solanaAddress ? void refreshSolanaWalletBalance() : void beginSolanaConnection()} disabled={solanaBusy}>{solanaBusy ? <LoaderCircle className="spin" size={13}/> : solanaAddress ? <RefreshCw size={13}/> : <Wallet size={13}/>} {solanaAddress ? "Refresh" : "Connect"}</button></div>}<label>Amount<div className="fund-amount"><input value={depositAmount} onChange={(event) => { setDepositAmount(event.target.value.replace(/[^0-9.]/g, "")); setDepositError(""); }} inputMode="decimal" /><span>USDC</span></div></label><div className="gateway-diagram"><ChainName chain={depositChain} size={20}/><i><ArrowRight size={16} /></i><span>Gateway</span><i><ArrowRight size={16} /></i><span>Unified</span></div><button className="neon-button" onClick={depositToGateway} disabled={depositBusy || !walletAddress || !(Number(depositAmount) > 0) || (depositChain === "Solana_Devnet" && !solanaAddress)}>{depositBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />} {depositBusy ? "Confirm in wallet…" : "Review deposit in wallet"}</button>{depositError && <p className="inline-error"><CircleAlert size={13} />{depositError}</p>}{solanaError && <p className="inline-error"><CircleAlert size={13} />{solanaError}</p>}<small><ShieldCheck size={12} /> Testnet transaction. App Kit switches to the source chain; OffGrid keeps reading Arc independently.</small></article></div>}

      {showOnRamp && <FiatOnRampModal onClose={() => setShowOnRamp(false)} walletAddress={displayWalletAddress} onSuccess={() => { void loadBalances(); void refreshCurrentUser(); }} />}

      {invoice && <Invoice invoice={invoice} user={user} onClose={resetPayment} />}
    </main>
  );
}
