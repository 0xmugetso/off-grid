"use client";

import { ArrowRight, Banknote, Bell, Check, CircleAlert, Copy, ExternalLink, LoaderCircle, LockKeyhole, Radio, ShieldCheck, Wallet, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, erc20Abi, getAddress, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { AuthScreen } from "@/components/offgrid-dashboard";
import type { DatabaseUserView, PaymentRail, PaymentSessionView } from "@/lib/payment-session-types";
import { discoverBrowserWallets, ensureArcTestnet, requestWalletAccount } from "@/lib/arc/browser-wallet";
import { ThemeToggle } from "@/components/theme-toggle";
import { ARC } from "@/lib/arc/config";

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
    ? "Minting destination USDC"
    : payer === "web3_usdc" && receiver === "fiat_bank"
      ? "Routing fiat payout"
      : "USDC transfer";
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
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fiatStatus, setFiatStatus] = useState<{ configured: boolean; checks: Array<{ key: string; label: string; configured: boolean }> } | null>(null);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [liveNotice, setLiveNotice] = useState<{ title: string; detail: string } | null>(null);
  const sessionSnapshotRef = useRef<string | null>(null);

  useEffect(() => { request<{ user: DatabaseUserView | null }>("/api/auth/me").then(({ user }) => setUser(user)).finally(() => setBooting(false)); }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const sync = async () => {
      if (document.hidden) return;
      try {
        const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}`);
        if (cancelled) return;
        const snapshot = `${response.session.status}:${response.session.nextAction}:${response.session.invoiceId ?? ""}`;
        if (sessionSnapshotRef.current && sessionSnapshotRef.current !== snapshot) {
          setLiveNotice({
            title: response.session.status === "ready" ? "Both payment choices are locked" : response.session.status === "complete" ? "Settlement confirmed" : "Payment session updated",
            detail: response.session.nextActionLabel,
          });
        }
        sessionSnapshotRef.current = snapshot;
        setSession(response.session);
      } catch (cause) {
        if (!session && !cancelled) setError(cause instanceof Error ? cause.message : "Unable to open payment session");
      }
    };
    void sync();
    const interval = window.setInterval(sync, 4_000);
    document.addEventListener("visibilitychange", sync);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", sync); };
  }, [token, user]);
  useEffect(() => {
    if (!liveNotice) return;
    const timeout = window.setTimeout(() => setLiveNotice(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [liveNotice]);
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
      const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "respond",
          rail,
          receiverBankDetails: null,
        }),
      });
      setSession(response.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept payment session");
    } finally { setBusy(false); }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  }

  async function advanceSettlement(silent = false, payload: { txHash?: string } = {}) {
    if (!silent) setSettlementBusy(true);
    setError("");
    try {
      const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}/settlement`, { method: "POST", body: JSON.stringify(payload) });
      setSession(response.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to advance sandbox settlement");
    } finally {
      if (!silent) setSettlementBusy(false);
    }
  }

  async function sendWeb3Deposit() {
    const destination = session?.fiatSettlement?.circleDepositAddress;
    if (!session || !destination) return;
    setSettlementBusy(true); setError("");
    try {
      const wallets = await discoverBrowserWallets();
      const selected = wallets.find(({ info }) => info.rdns === "io.metamask" || info.name === "MetaMask") ?? wallets[0];
      if (!selected) throw new Error("No EVM wallet found");
      const account = await requestWalletAccount(selected.provider);
      if (user?.walletAddress && account.toLowerCase() !== user.walletAddress.toLowerCase()) throw new Error("Use the wallet bound to this OffGrid account");
      await ensureArcTestnet(selected.provider);
      const wallet = createWalletClient({ account, chain: arcTestnet, transport: custom(selected.provider) });
      const txHash = await wallet.writeContract({ address: ARC.contracts.usdc, abi: erc20Abi, functionName: "transfer", args: [getAddress(destination), parseUnits(session.amount, ARC.usdcDecimals)] });
      const response = await request<{ session: PaymentSessionView }>(`/api/payment-sessions/${token}/settlement`, { method: "POST", body: JSON.stringify({ txHash }) });
      setSession(response.session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send the Circle deposit"); }
    finally { setSettlementBusy(false); }
  }

  useEffect(() => {
    const active = Boolean(session?.fiatSettlement)
      && (session?.payerRail === "fiat_bank" || session?.receiverRail === "fiat_bank")
      && session?.fiatSettlement?.stage !== "complete";
    if (!active) return;
    if (session?.fiatSettlement?.stage === "not_started" && session.actionRole !== "payer") return;
    const timer = window.setInterval(() => { if (!document.hidden) void advanceSettlement(true); }, 8_000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.fiatSettlement?.stage, session?.payerRail, session?.receiverRail]);

  if (booting) return <main className="boot-screen"><Logo /><LoaderCircle className="spin" /><span>OPENING SECURE PAYMENT SESSION</span></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  const otherParty = session?.role === "creator" ? session.counterparty : session?.creator;
  const hasFiatLeg = session?.payerRail === "fiat_bank" || session?.receiverRail === "fiat_bank";

  return (
    <main className="session-shell">
      <header><a href="/"><Logo /><b>offgrid</b></a><span><LockKeyhole size={12} /> PRIVATE PAYMENT SESSION</span><em><i /> ARC TESTNET</em><ThemeToggle /></header>
      <section className="session-stage">
        <div className="session-intro"><span><Radio size={11} /> ENCRYPTION-GRADE INVITE</span><h1>One payment.<br /><em>Two choices.</em></h1><p>The terms live on the server. The URL is only an unguessable invite capability. Editing it cannot change the amount, direction, or participants.</p></div>
        {error && !session ? <article className="session-error"><CircleAlert size={24} /><h2>Session unavailable</h2><p>{error}</p><a href="/">Return to OffGrid</a></article> : !session ? <article className="session-loading"><LoaderCircle className="spin" /><span>VERIFYING INVITE</span></article> : (
          <article className="session-window">
            <div className="session-window-head"><div><span>PAYMENT SESSION</span><b>{session.id.slice(0, 8).toUpperCase()}</b></div><strong className={session.status}><i />{session.status}</strong></div>
            
            {/* Dynamic Animated Progress Pipeline */}
            <SessionProgressBar session={session} isClearing={session.clearingStatus === "clearing_on_arc"} />

            <div className="session-value"><small>AGREED AMOUNT</small><b>{Number(session.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}<em> USDC / USD</em></b>{session.memo && <p>{session.memo}</p>}</div>
            <div className="session-parties">
              <div><small>CREATOR</small><b>{session.creator?.displayName}</b><em>{session.creatorIntent === "pay" ? "PAYS" : "RECEIVES"} · {railName(session.creatorRail)}</em></div>
              <i><ArrowRight size={17} /></i>
              <div><small>COUNTERPARTY</small><b>{session.counterparty?.displayName ?? "Waiting for invitee"}</b><em>{session.creatorIntent === "pay" ? "RECEIVES" : "PAYS"} · {railName(session.counterpartyRail)}</em></div>
            </div>

            {session.role === "creator" && session.status === "open" && <div className="session-action"><span className="section-tag">SHARE SECURELY</span><h2>Send this payment window.</h2><p>Only the first authenticated invitee can claim the counterparty position. After that, every other account is denied.</p><button className="neon-button" onClick={copyLink}><Copy size={15} />{copied ? "Payment link copied" : "Copy private payment link"}</button></div>}

            {session.role === "invitee" && session.status === "open" && (
              <div className="session-action">
                <span className="section-tag">YOUR PREFERENCE</span>
                <h2>How do you want to {session.actionRole === "payer" ? "pay" : "receive"}?</h2>
                <p>Your selection becomes part of the locked two-party payment terms.</p>
                <div className="session-rail-options">
                  <button type="button" className={rail === "web3_usdc" ? "active" : ""} onClick={() => setRail("web3_usdc")}><Wallet size={19} /><span><b>Web3 USDC</b><small>Direct, Gateway, or CCTP</small></span>{rail === "web3_usdc" ? <Check size={15} /> : null}</button>
                  <button type="button" className={rail === "fiat_bank" ? "active" : ""} disabled={session.actionRole === "payer" && Number(session.amount) < 2} title={session.actionRole === "payer" && Number(session.amount) < 2 ? "Circle Mint sandbox bank payments require at least 2.00 USD" : undefined} onClick={() => setRail("fiat_bank")}><Banknote size={19} /><span><b>Bank / fiat</b><small>{session.actionRole === "payer" && Number(session.amount) < 2 ? "Minimum 2.00 USD" : "Circle Mint wire settlement"}</small></span>{rail === "fiat_bank" ? <Check size={15} /> : null}</button>
                </div>
                {rail === "fiat_bank" && <div className="session-rail-advisory"><CircleAlert size={14} /><p><b>Provider-orchestrated rail</b><span>This choice locks the bank side of the route. It does not report settlement until Circle returns proof for each required stage.</span></p></div>}
                {session.actionRole === "payer" && Number(session.amount) < 2 && <div className="session-rail-advisory"><CircleAlert size={14} /><p><b>Bank funding is unavailable for this amount</b><span>Circle Mint sandbox mock wires start at 2.00 USD. Choose Web3 USDC or ask the creator to open a new session.</span></p></div>}

                {rail === "fiat_bank" && session.actionRole === "receiver" && (
                  <div className="sandbox-bank-destination">
                    <span><Banknote size={16} /></span><div><small>OFFGRID SANDBOX DESTINATION</small><b>Platform test bank account</b><p>No personal bank details are collected. Circle simulates this payout and returns provider proof. No real fiat moves.</p></div><Check size={15} />
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
                    ? "Crypto-to-Fiat Settlement"
                    : session.payerRail === "fiat_bank" && session.receiverRail === "web3_usdc"
                    ? "Fiat-to-Crypto Settlement"
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
                    <p>The payer sends real Arc Testnet USDC to the Circle Mint deposit address below. OffGrid verifies the transaction, matches Circle's inbound transfer, then starts a sandbox wire payout. No real fiat moves.</p>
                    <ProviderRouteStatus status={fiatStatus} label="Web3 to fiat" settlement={session.fiatSettlement} />
                    {session.actionRole === "payer" && !session.fiatSettlement && <button className="provider-action-button" disabled={settlementBusy || !fiatStatus?.configured} onClick={() => advanceSettlement()}><span>{settlementBusy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}</span><div><b>Create Circle deposit address</b></div><ArrowRight size={16} /></button>}
                    {session.fiatSettlement?.circleDepositAddress && session.fiatSettlement.stage === "awaiting_web3_deposit" && <div className="sandbox-bank-destination"><span><Wallet size={16} /></span><div><small>CIRCLE ARC DEPOSIT ADDRESS</small><b title={session.fiatSettlement.circleDepositAddress}>{session.fiatSettlement.circleDepositAddress.slice(0, 12)}…{session.fiatSettlement.circleDepositAddress.slice(-8)}</b><p>Send exactly {session.amount} USDC from your connected payer wallet.</p></div><button type="button" onClick={() => navigator.clipboard.writeText(session.fiatSettlement!.circleDepositAddress!)} aria-label="Copy Circle deposit address"><Copy size={14} /></button></div>}
                    {session.actionRole === "payer" && session.fiatSettlement?.stage === "awaiting_web3_deposit" && <button className="neon-button" disabled={settlementBusy} onClick={sendWeb3Deposit}>{settlementBusy ? <LoaderCircle className="spin" size={15} /> : <Zap size={15} />} Send {session.amount} USDC to Circle</button>}
                    {session.fiatSettlement && !["awaiting_web3_deposit", "complete"].includes(session.fiatSettlement.stage) && <button className="provider-action-button secondary" disabled={settlementBusy} onClick={() => advanceSettlement()}><span>{settlementBusy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}</span><div><b>{settlementBusy ? "Checking provider and chain proofs" : "Check current settlement status"}</b></div><ArrowRight size={16} /></button>}
                  </>
                ) : session.payerRail === "fiat_bank" && session.receiverRail === "web3_usdc" ? (
                  <>
                    <p>Circle records a sandbox wire deposit and exposes its deposit ID. After that proof is complete, a funded developer wallet sends real testnet USDC to the receiver.</p>
                    <ProviderRouteStatus status={fiatStatus} label="Fiat to Web3" settlement={session.fiatSettlement} />
                    {session.actionRole === "payer" && !session.fiatSettlement && <button className="provider-action-button" disabled={settlementBusy || !fiatStatus?.configured} onClick={() => advanceSettlement()}><span>{settlementBusy ? <LoaderCircle className="spin" size={17} /> : <Banknote size={17} />}</span><div><b>Start sandbox bank payment</b></div><ArrowRight size={16} /></button>}
                    {session.actionRole === "payer" && session.fiatSettlement && session.fiatSettlement.stage !== "complete" && <button className="provider-action-button secondary" disabled={settlementBusy} onClick={() => advanceSettlement()}><span>{settlementBusy ? <LoaderCircle className="spin" size={17} /> : <Radio size={17} />}</span><div><b>{settlementBusy ? "Checking provider and chain proofs" : "Check current settlement status"}</b></div><ArrowRight size={16} /></button>}
                    {session.actionRole !== "payer" && session.fiatSettlement?.stage === "not_started" && <div className="provider-waiting-state"><span><Radio size={17} /></span><div><small>WAITING FOR PAYER</small><b>The bank-side participant starts this route</b><p>This page will update automatically as each provider proof arrives.</p></div></div>}
                  </>
                ) : session.payerRail === "fiat_bank" && session.receiverRail === "fiat_bank" ? (
                  <><p>The payer deposit must settle in Circle Mint before a separate redemption can be sent to the receiver's linked and verified bank account.</p><ProviderRouteStatus status={fiatStatus} label="Fiat to fiat" /></>
                ) : session.actionRole === "payer" ? (
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
            {session.status === "complete" && !session.invoiceId && hasFiatLeg && <div className="session-action complete"><Check size={26} /><span className="section-tag">PROVIDER SETTLEMENT</span><h2>Provider settlement recorded.</h2><p>Open History to verify the provider ID, current status, and every available settlement proof.</p><a className="neon-button" href="/"><ArrowRight size={14} /> Back to dashboard</a></div>}
            <footer><ShieldCheck size={12} /> Authenticated participants · immutable server terms · invite expires {new Date(session.expiresAt).toLocaleDateString()}</footer>
          </article>
        )}
      </section>
      {liveNotice && <div className="session-live-notice" role="status"><span><Bell size={15} /></span><div><b>{liveNotice.title}</b><p>{liveNotice.detail}</p></div><button type="button" onClick={() => setLiveNotice(null)} aria-label="Dismiss notification"><X size={13} /></button></div>}
    </main>
  );
}

function ProviderRouteStatus({ status, label, settlement }: { status: { configured: boolean; checks: Array<{ key: string; label: string; configured: boolean }> } | null; label: string; settlement?: PaymentSessionView["fiatSettlement"] }) {
  const web3ToFiat = settlement?.mode === "web3_to_fiat" || label === "Web3 to fiat";
  const providerComplete = (value?: string | null) => ["complete", "completed", "confirmed", "success", "succeeded"].includes(value?.toLowerCase() || "");
  const stages = web3ToFiat ? [
    { key: "awaiting_web3_deposit", label: "Deposit address created", description: "Circle issued the address that receives the payer's testnet USDC.", proofLabel: "Circle address", proof: settlement?.circleDepositAddress, href: null, verified: Boolean(settlement?.circleDepositAddress) },
    { key: "web3_deposit_submitted", label: "Payer deposit verified", description: "The exact USDC amount and Circle destination were matched onchain.", proofLabel: settlement?.payerTransferBlockNumber ? `Arc block ${settlement.payerTransferBlockNumber}` : "Arc transaction", proof: settlement?.payerTransferTxHash, href: settlement?.payerTransferTxHash ? `https://testnet.arcscan.app/tx/${settlement.payerTransferTxHash}` : null, verified: Boolean(settlement?.payerTransferTxHash && settlement?.payerTransferBlockNumber) },
    { key: "circle_inbound_confirmed", label: "Circle received the USDC", description: "Circle's transfer API reports the inbound transfer complete.", proofLabel: `Circle ${settlement?.circleInboundTransferStatus || "transfer"}`, proof: settlement?.circleInboundTransferId, href: null, verified: Boolean(settlement?.circleInboundTransferId && providerComplete(settlement?.circleInboundTransferStatus)) },
    { key: "complete", label: "Sandbox bank payout confirmed", description: "Circle accepted the payout to the linked test bank destination.", proofLabel: `Circle ${settlement?.circlePayoutStatus || "payout"}`, proof: settlement?.circlePayoutId, href: null, verified: Boolean(settlement?.circlePayoutId && providerComplete(settlement?.circlePayoutStatus)) },
  ] : [
    { key: "wire_submitted", label: "Sandbox wire accepted", description: "Circle accepted the simulated bank payment and returned a tracking reference.", proofLabel: "Wire reference", proof: settlement?.mockWireTrackingRef, href: null, verified: Boolean(settlement?.mockWireTrackingRef) },
    { key: "circle_deposit_confirmed", label: "Circle deposit confirmed", description: `Circle reports the ${settlement?.circleDepositAmount || "expected"} USD deposit complete.`, proofLabel: `Circle ${settlement?.circleDepositStatus || "deposit"}`, proof: settlement?.circleDepositId, href: null, verified: Boolean(settlement?.circleDepositId && providerComplete(settlement?.circleDepositStatus)) },
    { key: "receiver_transfer_submitted", label: "USDC delivery created", description: "The developer-controlled wallet submitted the receiver's testnet USDC transfer.", proofLabel: `Wallet transfer ${settlement?.receiverTransferState || "submitted"}`, proof: settlement?.receiverTransferId, href: null, verified: Boolean(settlement?.receiverTransferId) },
    { key: "complete", label: "Receiver paid onchain", description: `OffGrid matched the recipient, token, and exact amount${settlement?.arcBlockNumber ? ` in Arc block ${settlement.arcBlockNumber}` : " in the transaction receipt"}.`, proofLabel: settlement?.arcBlockNumber ? `Arc block ${settlement.arcBlockNumber}` : "Arc transaction", proof: settlement?.receiverTxHash, href: settlement?.receiverTxHash ? `https://testnet.arcscan.app/tx/${settlement.receiverTxHash}` : null, verified: Boolean(settlement?.receiverTxHash && settlement?.arcBlockNumber) },
  ];
  const failed = settlement?.stage === "failed";
  const stageStates = stages.map((stage) => ({
    ...stage,
    done: !failed && Boolean(settlement) && stage.verified,
  }));
  const activeIndex = failed ? -1 : Math.max(0, stageStates.findIndex((stage) => !stage.done));
  const completedCount = stageStates.filter((stage) => stage.done).length;
  const isWaitingForPayer = settlement?.stage === "not_started";
  const visibleError = settlement?.error && !settlement.error.startsWith("Only the payer") ? settlement.error : null;
  const routeState = failed ? "Needs attention" : settlement?.stage === "complete" ? "Settlement verified" : isWaitingForPayer ? "Ready for payer" : settlement ? "Proofs arriving" : "Ready to begin";
  const routeDescription = web3ToFiat
    ? "A real testnet USDC deposit is verified first. Circle then records the sandbox bank payout."
    : "Circle confirms the simulated bank deposit first. A developer-controlled wallet then delivers real testnet USDC to the receiver.";

  return <div className={`provider-route-status${failed ? " failed" : ""}`}>
    <div className="provider-route-head"><span className="provider-route-icon"><Banknote size={18} /></span><div><b>{status?.configured ? label : "Provider setup required"}</b><p>{routeDescription}</p></div><strong>{completedCount}<span>/4</span><small> PROOFS</small></strong></div>
    {settlement ? <>
      <div className="provider-progress-track" aria-hidden="true"><span style={{ width: `${Math.max(4, completedCount * 25)}%` }} /></div>
      <div className="provider-proof-steps">{stageStates.map((stage, index) => { const active = index === activeIndex; const proof = stage.proof ? `${stage.proof.slice(0, 12)}…${stage.proof.slice(-6)}` : null; return <div className={stage.done ? "done" : active ? "active" : "upcoming"} key={stage.key}><i>{stage.done ? <Check size={12} /> : active ? <Radio size={11} /> : index + 1}</i><span><b>{stage.label}</b><p>{stage.description}</p>{proof && <small>{stage.proofLabel}</small>}{proof && (stage.href ? <a href={stage.href} target="_blank" rel="noreferrer" title={stage.proof || undefined}>{proof} <ExternalLink size={11} /></a> : <code title={stage.proof || undefined}>{proof}</code>)}</span></div>; })}</div>
      <p className="provider-proof-note"><ShieldCheck size={13} /><span><b>{routeState}</b> Checkmarks appear only after OffGrid receives the provider ID or validates the onchain receipt required for that step.</span></p>
    </> : <p>{web3ToFiat ? "Prepare the deposit address, send the exact USDC amount, then follow each verified inbound and payout proof here." : "Start the test wire, then follow the Circle deposit, wallet transfer, and final onchain confirmation here."}</p>}
    {visibleError && <p className="inline-error"><CircleAlert size={14} />{visibleError}</p>}
    {!settlement && status && !status.configured && <div className="fiat-checks">{status.checks.map((check) => <span className={check.configured ? "done" : ""} key={check.key}><i>{check.configured ? <Check size={9} /> : "!"}</i>{check.label}</span>)}</div>}
  </div>;
}
