"use client";

import { ArrowRight, Banknote, Check, CircleAlert, Copy, ExternalLink, LoaderCircle, LockKeyhole, Radio, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/offgrid-dashboard";
import type { DatabaseUserView, PaymentRail, PaymentSessionView } from "@/lib/payment-session-types";
import { discoverBrowserWallets, ensureArcTestnet, requestWalletAccount } from "@/lib/arc/browser-wallet";
import { ThemeToggle } from "@/components/theme-toggle";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

function Logo() { return <span className="og-logo"><i /><i /><i /></span>; }
function railName(rail: PaymentRail | null) { return rail === "web3_usdc" ? "Web3 USDC" : rail === "fiat_bank" ? "Bank / fiat" : "Not selected"; }

export function PaymentSessionWindow({ token }: { token: string }) {
  const [user, setUser] = useState<DatabaseUserView | null>(null);
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<PaymentSessionView | null>(null);
  const [rail, setRail] = useState<PaymentRail>("web3_usdc");
  const [busy, setBusy] = useState(false);
  const [fiatBusy, setFiatBusy] = useState(false);
  const [fundBusy, setFundBusy] = useState(false);
  const [sandboxFunded, setSandboxFunded] = useState(false);
  const [error, setError] = useState("");
  const [fiatError, setFiatError] = useState("");
  const [fundError, setFundError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fiatPayout, setFiatPayout] = useState<{ id: string; status: string; trackingRef?: string | null; circlePayoutId?: string | null } | null>(null);
  const [fundNotice, setFundNotice] = useState<{ amount: string; trackingRef: string | null; status: string } | null>(null);
  const [fiatStatus, setFiatStatus] = useState<{ configured: boolean; checks: Array<{ key: string; label: string; configured: boolean }> } | null>(null);

  useEffect(() => { request<{ user: DatabaseUserView | null }>("/api/auth/me").then(({ user }) => setUser(user)).finally(() => setBooting(false)); }, []);
  useEffect(() => {
    if (!user) return;
    request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}`).then(({ session }) => setSession(session)).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to open payment session"));
  }, [token, user]);
  useEffect(() => {
    if (session?.status !== "ready" || (session.payerRail !== "fiat_bank" && session.receiverRail !== "fiat_bank")) return;
    request<{ configured: boolean; checks: Array<{ key: string; label: string; configured: boolean }> }>("/api/fiat/status").then(setFiatStatus).catch(() => setFiatStatus(null));
  }, [session]);

  async function bindWallet() {
    const wallets = await discoverBrowserWallets();
    const selected = wallets.find(({ info }) => info.rdns === "io.metamask" || info.name === "MetaMask") ?? wallets[0];
    if (!selected) throw new Error("No EVM wallet found");
    const address = await requestWalletAccount(selected.provider);
    await ensureArcTestnet(selected.provider);
    const response = await request<{ user: DatabaseUserView }>("/api/account/wallet", { method: "PATCH", body: JSON.stringify({ walletAddress: address }) });
    setUser(response.user);
    return response.user;
  }

  async function acceptInvite() {
    setBusy(true); setError("");
    try {
      let current = user;
      if (rail === "web3_usdc" && !current?.walletAddress) current = await bindWallet();
      const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}`, { method: "PATCH", body: JSON.stringify({ action: "respond", rail }) });
      setSession(response.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept payment session");
    } finally { setBusy(false); }
  }

  async function createSandboxBankPayout() {
    if (!session) return;
    setFiatBusy(true); setFiatError("");
    try {
      const response = await request<{ payout: { id: string; status: string; trackingRef?: string | null; circlePayoutId?: string | null } }>("/api/fiat/payouts", {
        method: "POST",
        body: JSON.stringify({
          amount: session.amount,
          reference: session.memo || session.id,
          paymentSessionToken: token,
        }),
      });
      setFiatPayout(response.payout);
      setSession((current) => current ? { ...current, status: "complete" } : current);
      await request<{ payouts: unknown[] }>("/api/fiat/payouts").catch(() => undefined);
    } catch (cause) {
      setFiatError(cause instanceof Error ? cause.message : "Unable to create sandbox bank payout");
    } finally {
      setFiatBusy(false);
    }
  }

  async function fundSandboxBalance() {
    if (!session) return;
    setFundBusy(true); setFundError("");
    try {
      const amount = Math.max(Number(session.amount) + 20, 50).toFixed(2);
      const response = await request<{ funding: { amount: string; trackingRef: string | null; status: string }, user: DatabaseUserView | null }>("/api/fiat/fund", {
        method: "POST",
        body: JSON.stringify({
          amount,
          memo: session.memo || session.id,
        }),
      });
      setFundNotice(response.funding);
      setSandboxFunded(true);
      if (response.user) setUser(response.user);
      await request<{ configured: boolean }>(`/api/fiat/status`).catch(() => undefined);
    } catch (cause) {
      setFundError(cause instanceof Error ? cause.message : "Unable to fund sandbox balance");
    } finally {
      setFundBusy(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  }

  if (booting) return <main className="boot-screen"><Logo /><LoaderCircle className="spin" /><span>OPENING SECURE PAYMENT SESSION</span></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  const otherParty = session?.role === "creator" ? session.counterparty : session?.creator;
  const hasFiatLeg = session?.payerRail === "fiat_bank" || session?.receiverRail === "fiat_bank";
  const readyForWeb3 = session?.status === "ready" && !hasFiatLeg;

  return (
    <main className="session-shell">
      <header><a href="/"><Logo /><b>offgrid</b></a><span><LockKeyhole size={12} /> PRIVATE PAYMENT SESSION</span><em><i /> ARC TESTNET</em><ThemeToggle /></header>
      <section className="session-stage">
        <div className="session-intro"><span><Radio size={11} /> ENCRYPTION-GRADE INVITE</span><h1>One payment.<br /><em>Two choices.</em></h1><p>The terms live on the server. The URL is only an unguessable invite capability—editing it cannot change the amount, direction, or participants.</p></div>
        {error && !session ? <article className="session-error"><CircleAlert size={24} /><h2>Session unavailable</h2><p>{error}</p><a href="/">Return to OffGrid</a></article> : !session ? <article className="session-loading"><LoaderCircle className="spin" /><span>VERIFYING INVITE</span></article> : (
          <article className="session-window">
            <div className="session-window-head"><div><span>PAYMENT SESSION</span><b>{session.id.slice(0, 8).toUpperCase()}</b></div><strong className={session.status}><i />{session.status}</strong></div>
            <div className="session-value"><small>AGREED AMOUNT</small><b>{Number(session.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}<em> USDC / USD</em></b>{session.memo && <p>{session.memo}</p>}</div>
            <div className="session-parties">
              <div><small>CREATOR</small><b>{session.creator?.displayName}</b><span>@{session.creator?.username}</span><em>{session.creatorIntent === "pay" ? "PAYS" : "RECEIVES"} · {railName(session.creatorRail)}</em></div>
              <i><ArrowRight size={17} /></i>
              <div><small>COUNTERPARTY</small><b>{session.counterparty?.displayName ?? "Waiting for invitee"}</b><span>{session.counterparty ? `@${session.counterparty.username}` : "Secure link not claimed"}</span><em>{session.creatorIntent === "pay" ? "RECEIVES" : "PAYS"} · {railName(session.counterpartyRail)}</em></div>
            </div>

            {session.role === "creator" && session.status === "open" && <div className="session-action"><span className="section-tag">SHARE SECURELY</span><h2>Send this payment window.</h2><p>Only the first authenticated invitee can claim the counterparty position. After that, every other account is denied.</p><button className="neon-button" onClick={copyLink}><Copy size={15} />{copied ? "Payment link copied" : "Copy private payment link"}</button></div>}

            {session.role === "invitee" && session.status === "open" && <div className="session-action"><span className="section-tag">YOUR PREFERENCE</span><h2>How do you want to {session.actionRole === "payer" ? "pay" : "receive"}?</h2><p>Your selection becomes part of the locked two-party payment terms.</p><div className="session-rail-options"><button className={rail === "web3_usdc" ? "active" : ""} onClick={() => setRail("web3_usdc")}><Wallet size={19} /><span><b>Web3 USDC</b><small>Arc, Gateway, or CCTP</small></span>{rail === "web3_usdc" && <Check size={15} />}</button><button className={rail === "fiat_bank" ? "active" : ""} onClick={() => setRail("fiat_bank")}><Banknote size={19} /><span><b>Bank / fiat</b><small>Sandbox provider required</small></span>{rail === "fiat_bank" && <Check size={15} />}</button></div><button className="neon-button" disabled={busy} onClick={acceptInvite}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Accept & lock my choice</button>{error && <p className="inline-error"><CircleAlert size={13} />{error}</p>}</div>}

            {session.status === "ready" && <div className="session-action ready"><span className="section-tag">BOTH SIDES LOCKED</span><h2>{hasFiatLeg ? fiatStatus?.configured ? sandboxFunded ? "Sandbox funded. Ready to pay." : "Sandbox provider connected." : "Fiat provider required." : session.actionRole === "payer" ? "Ready for your signature." : "Waiting for the payer."}</h2>{hasFiatLeg ? <><p>{session.actionRole === "payer" ? "Top up the sandbox balance first, then submit the payout. This mirrors a real provider flow without moving real money." : "The agreement is valid, and the sandbox bank balance can be topped up for testing. This exercises the real Circle Mint test endpoint without moving real money."}</p>{fiatStatus && <div className="fiat-checks">{fiatStatus.checks.map((check) => <span className={check.configured ? "done" : ""} key={check.key}><i>{check.configured ? <Check size={9} /> : "!"}</i>{check.label}</span>)}</div>}<div className="fiat-action-row">{fiatStatus?.configured && !sandboxFunded && <button className="session-cta session-cta-primary" onClick={fundSandboxBalance} disabled={fundBusy || fiatBusy}>{fundBusy ? <LoaderCircle className="spin" size={15} /> : <Banknote size={15} />} <span>{fundBusy ? "Funding sandbox…" : "Fund sandbox balance"}</span></button>}{fiatStatus?.configured && session.actionRole === "payer" && sandboxFunded && <button className="session-cta session-cta-primary" onClick={createSandboxBankPayout} disabled={fiatBusy || fundBusy}>{fiatBusy ? <LoaderCircle className="spin" size={15} /> : <Banknote size={15} />} <span>{fiatBusy ? "Submitting bank payout…" : "Proceed to sandbox payout"}</span></button>}{fiatStatus?.configured && session.actionRole === "payer" && !sandboxFunded && <button className="session-cta session-cta-secondary" disabled><Banknote size={15} /> <span>Pay sandbox balance after funding</span></button>}</div>{fundNotice && <p className="inline-note"><Check size={13} /> Sandbox deposit submitted for {fundNotice.amount}{fundNotice.trackingRef ? ` · tracking ${fundNotice.trackingRef}` : ""}. You can now proceed to the payout step.</p>}{fundError && <p className="inline-error"><CircleAlert size={13} />{fundError}</p>}{fiatError && <p className="inline-error"><CircleAlert size={13} />{fiatError}</p>}<a className="session-guide-link" href="https://developers.circle.com/circle-mint/references/sandbox-and-testing" target="_blank" rel="noreferrer"><ExternalLink size={11} /> Circle Mint sandbox guide</a></> : session.actionRole === "payer" ? <><p>The recipient and amount are locked from this session. Choose Arc, Gateway, or CCTP in the execution console.</p><a className="neon-button" href={`/?session=${encodeURIComponent(token)}`}><Zap size={15} /> Execute payment <ArrowRight size={14} /></a></> : <p>{otherParty?.displayName ?? "The payer"} can now execute the agreed USDC payment. This window will link both of you to the same receipt when it confirms.</p>}</div>}

            {session.status === "complete" && session.invoiceId && <div className="session-action complete"><Check size={26} /><span className="section-tag">PAYMENT FINALIZED</span><h2>Your shared receipt is ready.</h2><a className="neon-button" href={`/invoice/${session.invoiceId}`}>Open verified invoice <ExternalLink size={14} /></a></div>}
            {session.status === "complete" && !session.invoiceId && hasFiatLeg && <div className="session-action complete"><Check size={26} /><span className="section-tag">SANDBOX BANK PAYOUT</span><h2>Bank transaction submitted.</h2><p>{fiatPayout ? `Circle returned payout ${fiatPayout.circlePayoutId ?? fiatPayout.id}. Track the status in History.` : "The Circle Mint sandbox payout request was accepted. Track the bank transfer in History."}</p>{fiatPayout?.trackingRef && <div className="session-created-link"><LockKeyhole size={15} /><span>{fiatPayout.trackingRef}</span></div>}<a className="neon-button" href="/"><ArrowRight size={14} /> Back to dashboard</a></div>}
            <footer><ShieldCheck size={12} /> Authenticated participants · immutable server terms · invite expires {new Date(session.expiresAt).toLocaleDateString()}</footer>
          </article>
        )}
      </section>
    </main>
  );
}
