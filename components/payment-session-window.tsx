"use client";

import { ArrowRight, Banknote, Check, CircleAlert, Copy, ExternalLink, LoaderCircle, LockKeyhole, Network, Radio, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/offgrid-dashboard";
import type { DatabaseUserView, PaymentRail, PaymentSessionView } from "@/lib/payment-session-types";
import { discoverBrowserWallets, ensureArcTestnet, requestWalletAccount } from "@/lib/arc/browser-wallet";
import { ArcPayrollClient } from "@/lib/arc/app-kit-client";
import { ThemeToggle } from "@/components/theme-toggle";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    // Empty
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP error ${res.status}`);
  }
  return data as T;
}

function Logo() { return <span className="og-logo"><i /><i /><i /></span>; }
function railName(rail: PaymentRail | null) { return rail === "web3_usdc" ? "Web3 USDC" : rail === "fiat_bank" ? "Bank / fiat" : "Not selected"; }

function SessionProgressBar({ session, isClearing }: { session: PaymentSessionView; isClearing: boolean }) {
  const { status } = session;
  const step = status === "open" ? 1 : status === "ready" && !isClearing ? 2 : isClearing ? 3 : status === "complete" ? 4 : 1;
  const progressPercent = step === 1 ? 25 : step === 2 ? 50 : step === 3 ? 75 : 100;
  const payer = session.payerRail;
  const receiver = session.receiverRail;
  const choiceLabel = receiver === "fiat_bank"
    ? "Bank destination set"
    : receiver === "web3_usdc"
      ? "Wallet destination set"
      : session.actionRole === "receiver" ? "Choose receiving rail" : "Counterparty choice";
  const clearingLabel = payer === "fiat_bank" && receiver === "web3_usdc"
    ? "Minting USDC on Arc"
    : payer === "web3_usdc" && receiver === "fiat_bank"
      ? "Routing fiat payout"
      : "Arc USDC transfer";
  const finalLabel = receiver === "fiat_bank" ? "Fiat payout sent" : "USDC received";

  return (
    <div className="session-progress-pipeline">
      <div className="progress-pipeline-track">
        <div className="progress-pipeline-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="progress-pipeline-steps">
        <div className={`pipeline-step ${step >= 1 ? "active" : ""} ${step > 1 ? "done" : ""}`}>
          <div className="step-circle">{step > 1 ? <Check size={11} /> : "1"}</div>
          <span>Terms Set</span>
        </div>

        <div className={`pipeline-step ${step >= 2 ? "active" : ""} ${step > 2 ? "done" : ""}`}>
          <div className="step-circle">{step > 2 ? <Check size={11} /> : "2"}</div>
          <span>{choiceLabel}</span>
        </div>

        <div className={`pipeline-step ${step >= 3 ? "active" : ""} ${step > 3 ? "done" : ""}`}>
          <div className="step-circle">{step > 3 ? <Check size={11} /> : isClearing ? <LoaderCircle className="spin" size={11} /> : "3"}</div>
          <span>{clearingLabel}</span>
        </div>

        <div className={`pipeline-step ${step >= 4 ? "active" : ""} ${step > 4 ? "done" : ""}`}>
          <div className="step-circle">{step >= 4 ? <Check size={11} /> : "4"}</div>
          <span>{finalLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function PaymentSessionWindow({ token }: { token: string }) {
  const [user, setUser] = useState<DatabaseUserView | null>(null);
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<PaymentSessionView | null>(null);
  const [rail, setRail] = useState<PaymentRail>("web3_usdc");
  const [busy, setBusy] = useState(false);
  const [fiatBusy, setFiatBusy] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState("");
  const [fiatError, setFiatError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fiatPayout, setFiatPayout] = useState<{ id: string; status: string; trackingRef?: string | null; circlePayoutId?: string | null } | null>(null);
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

  const [accountHolderName, setAccountHolderName] = useState("");
  const [ibanOrAccountNumber, setIbanOrAccountNumber] = useState("");
  const [routingOrSwift, setRoutingOrSwift] = useState("");
  const [bankCountry, setBankCountry] = useState("US");

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
      if (rail === "fiat_bank") {
        if (!accountHolderName.trim()) throw new Error("Enter the bank account holder name");
        if (!ibanOrAccountNumber.trim()) throw new Error("Enter IBAN or Account Number");
      }
      const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "respond",
          rail,
          receiverBankDetails: rail === "fiat_bank" ? {
            accountHolderName,
            ibanOrAccountNumber,
            routingOrSwift,
            bankCountry,
          } : null,
        }),
      });
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

  async function executeBankWirePayout() {
    if (!session) return;
    setFiatBusy(true);
    setIsClearing(true);
    setFiatError("");
    try {
      // 1. Connect wallet and prompt USDC transfer on Arc Testnet (default)
      const wallets = await discoverBrowserWallets();
      if (!wallets.length) throw new Error("No EVM wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.");
      const wallet = wallets[0];
      await requestWalletAccount(wallet.provider);
      await ensureArcTestnet(wallet.provider);

      const client = new ArcPayrollClient();
      const adapter = await client.connectEvmWallet(wallet.provider);

      // 2. Sign and send USDC to the explicitly configured settlement address.
      // Never fall back to a demo address: a missing deployment must stop before signing.
      const escrowRecipient = process.env.NEXT_PUBLIC_ARC_SETTLEMENT_ADDRESS;
      if (!escrowRecipient || !/^0x[a-fA-F0-9]{40}$/.test(escrowRecipient)) {
        throw new Error("Crypto-to-fiat settlement is not configured: set NEXT_PUBLIC_ARC_SETTLEMENT_ADDRESS to the audited Arc settlement contract");
      }
      await client.sendArcUsdc(adapter, escrowRecipient, session.amount);

      // 3. Trigger Circle Mint Sandbox Wire Off-Ramp Payout
      const response = await request<{ payout: { id: string; status: string; trackingRef?: string | null; circlePayoutId?: string | null } }>("/api/fiat/payouts", {
        method: "POST",
        body: JSON.stringify({
          amount: session.amount,
          reference: session.memo || `SESSION-${session.id.slice(0, 8)}`,
          paymentSessionToken: token,
        }),
      });
      setFiatPayout(response.payout);
      setSession((current) => current ? { ...current, status: "complete" } : current);
      await request<{ payouts: unknown[] }>("/api/fiat/payouts").catch(() => undefined);
    } catch (cause) {
      setFiatError(cause instanceof Error ? cause.message : "Unable to execute bank wire payout");
    } finally {
      setFiatBusy(false);
      setIsClearing(false);
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

  return (
    <main className="session-shell">
      <header><a href="/"><Logo /><b>offgrid</b></a><span><LockKeyhole size={12} /> PRIVATE PAYMENT SESSION</span><em><i /> ARC TESTNET</em><ThemeToggle /></header>
      <section className="session-stage">
        <div className="session-intro"><span><Radio size={11} /> ENCRYPTION-GRADE INVITE</span><h1>One payment.<br /><em>Two choices.</em></h1><p>The terms live on the server. The URL is only an unguessable invite capability—editing it cannot change the amount, direction, or participants.</p></div>
        {error && !session ? <article className="session-error"><CircleAlert size={24} /><h2>Session unavailable</h2><p>{error}</p><a href="/">Return to OffGrid</a></article> : !session ? <article className="session-loading"><LoaderCircle className="spin" /><span>VERIFYING INVITE</span></article> : (
          <article className="session-window">
            <div className="session-window-head"><div><span>PAYMENT SESSION</span><b>{session.id.slice(0, 8).toUpperCase()}</b></div><strong className={session.status}><i />{session.status}</strong></div>
            
            {/* Dynamic Animated Progress Pipeline */}
            <SessionProgressBar session={session} isClearing={isClearing} />

            <div className="session-value"><small>AGREED AMOUNT</small><b>{Number(session.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}<em> USDC / USD</em></b>{session.memo && <p>{session.memo}</p>}</div>
            <div className="session-parties">
              <div><small>CREATOR</small><b>{session.creator?.displayName}</b><span>@{session.creator?.username}</span><em>{session.creatorIntent === "pay" ? "PAYS" : "RECEIVES"} · {railName(session.creatorRail)}</em></div>
              <i><ArrowRight size={17} /></i>
              <div><small>COUNTERPARTY</small><b>{session.counterparty?.displayName ?? "Waiting for invitee"}</b><span>{session.counterparty ? `@${session.counterparty.username}` : "Secure link not claimed"}</span><em>{session.creatorIntent === "pay" ? "RECEIVES" : "PAYS"} · {railName(session.counterpartyRail)}</em></div>
            </div>

            {session.role === "creator" && session.status === "open" && <div className="session-action"><span className="section-tag">SHARE SECURELY</span><h2>Send this payment window.</h2><p>Only the first authenticated invitee can claim the counterparty position. After that, every other account is denied.</p><button className="neon-button" onClick={copyLink}><Copy size={15} />{copied ? "Payment link copied" : "Copy private payment link"}</button></div>}

            {session.role === "invitee" && session.status === "open" && (
              <div className="session-action">
                <span className="section-tag">YOUR PREFERENCE</span>
                <h2>How do you want to {session.actionRole === "payer" ? "pay" : "receive"}?</h2>
                <p>Your selection becomes part of the locked two-party payment terms.</p>
                <div className="session-rail-options">
                  <button type="button" className={rail === "web3_usdc" ? "active" : ""} onClick={() => setRail("web3_usdc")}><Wallet size={19} /><span><b>Web3 USDC</b><small>Arc, Gateway, or CCTP</small></span>{rail === "web3_usdc" ? <Check size={15} /> : null}</button>
                  <button type="button" className={rail === "fiat_bank" ? "active" : ""} onClick={() => setRail("fiat_bank")}><Banknote size={19} /><span><b>Bank / fiat</b><small>Circle Mint wire settlement</small></span>{rail === "fiat_bank" ? <Check size={15} /> : null}</button>
                </div>

                {rail === "fiat_bank" && session.actionRole === "receiver" && (
                  <div className="receiver-bank-inputs" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0", textAlign: "left" }}>
                    <small style={{ color: "var(--acid)", font: "9px var(--mono)", textTransform: "uppercase" }}>Wire Payout Destination Account</small>
                    <input className="session-memo-input" value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} placeholder="Account Holder Name (e.g. John Doe)" />
                    <input className="session-memo-input" value={ibanOrAccountNumber} onChange={(e) => setIbanOrAccountNumber(e.target.value)} placeholder="IBAN / Account Number (e.g. US1234567890)" />
                    <input className="session-memo-input" value={routingOrSwift} onChange={(e) => setRoutingOrSwift(e.target.value)} placeholder="SWIFT / BIC / Routing Code (Optional)" />
                  </div>
                )}

                <button className="neon-button" disabled={busy} onClick={acceptInvite}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Accept & lock my choice</button>
                {error && <p className="inline-error"><CircleAlert size={13} />{error}</p>}
              </div>
            )}

            {session.status === "ready" && (
              <div className="session-action ready">
                <span className="section-tag">BOTH SIDES LOCKED</span>
                <h2>
                  {session.payerRail === "web3_usdc" && session.receiverRail === "fiat_bank"
                    ? "Arc Crypto-to-Fiat Settlement"
                    : session.payerRail === "fiat_bank" && session.receiverRail === "web3_usdc"
                    ? "Arc Fiat-to-Crypto Settlement"
                    : session.actionRole === "payer"
                    ? "Ready for your signature"
                    : "Waiting for payer execution"}
                </h2>
                
                {session.receiverBankDetails && (
                  <div className="bank-details-card" style={{ padding: "12px 16px", background: "rgba(199, 255, 61, 0.08)", border: "1px solid rgba(199, 255, 61, 0.25)", borderRadius: "10px", margin: "12px 0", textAlign: "left" }}>
                    <small style={{ color: "var(--acid)", font: "9px var(--mono)", letterSpacing: ".06em" }}>RECIPIENT BANK WIRE DETAILS (CIRCLE MINT DEPOSIT)</small>
                    <b style={{ display: "block", color: "#fff", fontSize: "14px", marginTop: "2px" }}>{session.receiverBankDetails.accountHolderName}</b>
                    <p style={{ color: "var(--muted)", fontSize: "11px", margin: "2px 0 0" }}>
                      IBAN/Account: <code>{session.receiverBankDetails.ibanOrAccountNumber}</code>
                      {session.receiverBankDetails.routingOrSwift ? ` · SWIFT: ${session.receiverBankDetails.routingOrSwift}` : ""}
                      {session.receiverBankDetails.bankCountry ? ` · Country: ${session.receiverBankDetails.bankCountry}` : ""}
                    </p>
                  </div>
                )}

                {/* Case A: Crypto-to-Fiat */}
                {session.payerRail === "web3_usdc" && session.receiverRail === "fiat_bank" ? (
                  <>
                    <p>
                      {session.actionRole === "payer"
                        ? "Payer signs USDC from a Web3 wallet to the configured Arc settlement contract. Circle Mint can wire fiat only after the provider and compliance workflow are configured."
                        : "Waiting for the payer to sign USDC transfer onto Arc. Circle Mint will wire fiat directly to your bank account."}
                    </p>
                    {session.actionRole === "payer" && (
                      <div className="fiat-action-row" style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", marginTop: "14px" }}>
                        <button className="session-cta session-cta-primary" onClick={executeBankWirePayout} disabled={fiatBusy}>
                          {fiatBusy ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}
                          <span>{fiatBusy ? "Clearing on Arc & Wiring Fiat..." : "Sign USDC & Execute Bank Wire Payout ⚡"}</span>
                        </button>
                      </div>
                    )}
                    {fiatError && <p className="inline-error"><CircleAlert size={13} />{fiatError}</p>}
                  </>
                ) : session.payerRail === "fiat_bank" && session.receiverRail === "web3_usdc" ? (
                  /* Case B: Fiat-to-Crypto */
                  <>
                    <p>
                      {session.actionRole === "payer"
                        ? "Payer sends fiat wire/card deposit to Circle Mint Sandbox. Circle Mint mints USDC on Arc Testnet, clearing in ~0.48s directly into the receiver's Web3 wallet address."
                        : "Waiting for the payer to complete bank wire deposit. USDC will be minted on Arc Testnet directly to your Web3 wallet."}
                    </p>
                    {session.actionRole === "payer" && (
                      <div className="fiat-action-row" style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", marginTop: "14px" }}>
                        <button className="session-cta session-cta-primary" onClick={createSandboxBankPayout} disabled={fiatBusy}>
                          {fiatBusy ? <LoaderCircle className="spin" size={16} /> : <Banknote size={16} />}
                          <span>{fiatBusy ? "Processing Fiat Deposit & Minting USDC..." : "Confirm Fiat Payment Sent 🏦"}</span>
                        </button>
                      </div>
                    )}
                    {fiatError && <p className="inline-error"><CircleAlert size={13} />{fiatError}</p>}
                  </>
                ) : session.actionRole === "payer" ? (
                  /* Case C: Web3 to Web3 */
                  <>
                    <p>The recipient and amount are locked. Proceed to execution console.</p>
                    <a className="neon-button" href={`/?session=${encodeURIComponent(token)}`}><Zap size={15} /> Execute payment <ArrowRight size={14} /></a>
                  </>
                ) : (
                  <p>{otherParty?.displayName ?? "The payer"} can now execute the agreed USDC payment. This window will link both of you to the same receipt when it confirms.</p>
                )}
              </div>
            )}

            {session.status === "complete" && session.invoiceId && <div className="session-action complete"><Check size={26} /><span className="section-tag">PAYMENT FINALIZED</span><h2>Your shared receipt is ready.</h2><a className="neon-button" href={`/invoice/${session.invoiceId}`}>Open verified invoice <ExternalLink size={14} /></a></div>}
            {session.status === "complete" && !session.invoiceId && hasFiatLeg && <div className="session-action complete"><Check size={26} /><span className="section-tag">CIRCLE MINT WIRE PAYOUT</span><h2>Bank transaction submitted.</h2><p>{fiatPayout ? `Circle returned payout ${fiatPayout.circlePayoutId ?? fiatPayout.id}. Track status in History.` : "The Circle Mint sandbox wire payout request was accepted. Track the bank transfer in History."}</p>{fiatPayout?.trackingRef && <div className="session-created-link"><LockKeyhole size={15} /><span>{fiatPayout.trackingRef}</span></div>}<a className="neon-button" href="/"><ArrowRight size={14} /> Back to dashboard</a></div>}
            <footer><ShieldCheck size={12} /> Authenticated participants · immutable server terms · invite expires {new Date(session.expiresAt).toLocaleDateString()}</footer>
          </article>
        )}
      </section>
    </main>
  );
}
