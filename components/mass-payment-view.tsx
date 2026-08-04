"use client";

import { ArrowRight, Check, ChevronDown, CircleAlert, CircleCheck, Copy, ExternalLink, LoaderCircle, Network, Plus, Search, Send, ShieldCheck, Trash2, Upload, UserPlus, Users, Wallet, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { MassPaymentResult } from "@/lib/arc/app-kit-client";

interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  walletAddress: string;
}

export type MassFunding = "arc_wallet" | "unified_balance";
export type MassTeamMember = {
  id: string;
  userId?: string;
  name: string;
  handle?: string;
  address: string;
  amount: string;
};
export type MassRunResult = MassPaymentResult & { receiptsSaved: number };

async function getDirectory(query: string) {
  const response = await fetch(`/api/users?query=${encodeURIComponent(query)}`);
  const data = await response.json() as { users?: DirectoryUser[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to search team directory");
  return data.users ?? [];
}

function money(value: number | string) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

export function MassPaymentView({ walletAddress, directBalance, unifiedBalance, onConnect, onExecute }: { walletAddress: string; directBalance: string | null; unifiedBalance: string | null; onConnect: () => void; onExecute: (members: MassTeamMember[], funding: MassFunding, onProgress: (completed: number, total: number) => void) => Promise<MassRunResult> }) {
  const [members, setMembers] = useState<MassTeamMember[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [allocation, setAllocation] = useState<"equal" | "custom">("equal");
  const [equalAmount, setEqualAmount] = useState("");
  const [funding, setFunding] = useState<MassFunding>("unified_balance");
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState("");
  const [result, setResult] = useState<MassRunResult | null>(null);
  const [partialSettledCount, setPartialSettledCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2 || isAddress(query.trim())) { setResults([]); return; }
    const timeout = window.setTimeout(() => getDirectory(query).then(setResults).catch(() => setResults([])), 220);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    if (showReview || partialSettledCount === 0) return;
    setMembers((current) => current.slice(partialSettledCount));
    setPartialSettledCount(0);
  }, [partialSettledCount, showReview]);

  const payableMembers = useMemo(() => members.map((member) => ({ ...member, amount: allocation === "equal" ? equalAmount : member.amount })), [allocation, equalAmount, members]);
  const total = payableMembers.reduce((sum, member) => sum + Number(member.amount || 0), 0);
  const available = Number((funding === "arc_wallet" ? directBalance : unifiedBalance) ?? 0);
  const amountsValid = members.length > 0 && payableMembers.every((member) => Number(member.amount) > 0);
  const insufficient = total > available;

  function addMember(member: Omit<MassTeamMember, "id" | "amount"> & { amount?: string }) {
    setError("");
    if (members.length >= 50) { setError("A payroll run is limited to 50 recipients"); return; }
    const address = getAddress(member.address);
    if (members.some((existing) => existing.address.toLowerCase() === address.toLowerCase())) { setError("That wallet is already in this payroll run"); return; }
    setMembers((current) => [...current, { ...member, id: crypto.randomUUID(), address, amount: member.amount ?? "" }]);
    setQuery(""); setResults([]);
  }

  function addFromQuery() {
    const address = query.trim();
    if (!isAddress(address)) { setError("Search for an OffGrid user or enter a valid 0x wallet"); return; }
    addMember({ name: `Wallet ${members.length + 1}`, address });
  }

  function importBulk() {
    setError("");
    const parsed: Array<Omit<MassTeamMember, "id">> = [];
    try {
      for (const [index, rawLine] of bulkText.split("\n").entries()) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split(",").map((part) => part.trim());
        const addressIndex = parts.findIndex((part) => isAddress(part));
        if (addressIndex < 0) throw new Error(`Line ${index + 1} needs a valid wallet address`);
        const address = getAddress(parts[addressIndex]);
        const name = parts.slice(0, addressIndex).join(", ") || `Wallet ${members.length + parsed.length + 1}`;
        const amount = parts[addressIndex + 1]?.replace(/[^0-9.]/g, "") ?? "";
        if (members.some((member) => member.address.toLowerCase() === address.toLowerCase()) || parsed.some((member) => member.address.toLowerCase() === address.toLowerCase())) throw new Error(`Line ${index + 1} duplicates a wallet`);
        parsed.push({ name, address, amount });
      }
      if (!parsed.length) throw new Error("Paste at least one wallet");
      if (members.length + parsed.length > 50) throw new Error("A payroll run is limited to 50 recipients");
      setMembers((current) => [...current, ...parsed.map((member) => ({ ...member, id: crypto.randomUUID() }))]);
      setBulkText(""); setShowBulk(false);
      if (parsed.some((member) => member.amount)) setAllocation("custom");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to import wallets"); }
  }

  async function execute() {
    if (!walletAddress || !amountsValid || insufficient) return;
    setBusy(true); setError(""); setResult(null); setProgress({ completed: 0, total: members.length });
    try {
      const completed = await onExecute(payableMembers, funding, (done, count) => setProgress({ completed: done, total: count }));
      if (completed.partial) setPartialSettledCount(completed.txHashes.length);
      setResult(completed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mass payment failed");
    } finally { setBusy(false); }
  }

  async function copyRun() {
    if (!result) return;
    await navigator.clipboard.writeText(result.txHashes.join("\n"));
    setCopied(true); window.setTimeout(() => setCopied(false), 1_500);
  }

  return <section className="mass-payment-view">
    <div className="mass-heading"><div><span className="section-tag">TEAM OPERATIONS</span><h1>Pay everyone.<br /><em>In one run.</em></h1><p>Build a clean team roster, choose equal or individual pay, then settle through Arc or your Unified Balance.</p></div><div className="mass-flow"><span className={members.length ? "done" : "active"}><i>{members.length ? <Check size={10} /> : "1"}</i><b>Team</b><small>Add recipients</small></span><em /><span className={amountsValid ? "done" : members.length ? "active" : ""}><i>{amountsValid ? <Check size={10} /> : "2"}</i><b>Amounts</b><small>Set allocation</small></span><em /><span className={amountsValid ? "active" : ""}><i>3</i><b>Settle</b><small>Review & sign</small></span></div></div>

    {!walletAddress ? <div className="mass-connect"><Users size={33} /><h2>Connect your treasury wallet first.</h2><p>Your wallet remains the signer. OffGrid never takes custody of payroll funds.</p><button className="neon-button" onClick={onConnect}><Wallet size={15} /> Connect wallet</button></div> : <div className="mass-layout">
      <section className="team-builder"><div className="team-builder-head"><div><span className="section-tag">01 · TEAM ROSTER</span><h2>Who gets paid?</h2><p>Search real OffGrid accounts or add any EVM wallet.</p></div><button onClick={() => setShowBulk((current) => !current)}><Upload size={13} /> Add wallets in bulk</button></div>
        <div className="team-search"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && isAddress(query.trim())) addFromQuery(); }} placeholder="Search @username or paste a 0x wallet" />{isAddress(query.trim()) && <button onClick={addFromQuery}><Plus size={13} /> Add wallet</button>}</div>
        {results.length > 0 && <div className="team-results">{results.map((person) => <button key={person.id} onClick={() => addMember({ userId: person.id, name: person.displayName, handle: `@${person.username}`, address: person.walletAddress })}><span>{person.displayName.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><b>{person.displayName}</b><small>@{person.username} · {shortAddress(person.walletAddress)}</small></div><UserPlus size={14} /></button>)}</div>}
        {showBulk && <div className="bulk-import"><div><span><Upload size={14} /> BULK WALLET IMPORT</span><button onClick={() => setShowBulk(false)}><X size={14} /></button></div><p>One recipient per line: <b>Name, wallet, optional amount</b></p><textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'Alice, 0x1234…, 1200\nBob, 0xabcd…, 1450'} /><button onClick={importBulk}><Plus size={13} /> Add valid wallets</button></div>}

        <div className="allocation-head"><div><span className="section-tag">02 · ALLOCATION</span><h3>{members.length ? `${members.length} team member${members.length === 1 ? "" : "s"}` : "Your roster is empty"}</h3></div><div className="allocation-toggle"><button className={allocation === "equal" ? "active" : ""} onClick={() => setAllocation("equal")}>Pay all the same</button><button className={allocation === "custom" ? "active" : ""} onClick={() => setAllocation("custom")}>Different amounts</button></div></div>
        {allocation === "equal" && members.length > 0 && <label className="equal-pay"><span><small>EACH PERSON RECEIVES</small><b>Equal amount across {members.length} wallets</b></span><div><input value={equalAmount} onChange={(event) => setEqualAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" inputMode="decimal" /><em>USDC</em></div></label>}
        <div className="team-table"><div className="team-table-head"><span>TEAM MEMBER</span><span>WALLET</span><span>AMOUNT</span><span /></div>{members.length === 0 ? <div className="team-empty"><UserPlus size={22} /><b>Add your first team member</b><p>Use directory search, paste one wallet, or import a list.</p></div> : payableMembers.map((member, index) => <div className="team-row" key={member.id}><span className="member-identity"><i>{member.name.split(" ").map((part) => part[0]).slice(0,2).join("")}</i><span><b>{member.name}</b><small>{member.handle ?? `Recipient ${index + 1}`}</small></span></span><code>{shortAddress(member.address)}</code><label className={allocation === "equal" ? "locked" : ""}><input value={member.amount} readOnly={allocation === "equal"} onChange={(event) => setMembers((current) => current.map((item) => item.id === member.id ? { ...item, amount: event.target.value.replace(/[^0-9.]/g, "") } : item))} placeholder="0.00" /><em>USDC</em></label><button onClick={() => setMembers((current) => current.filter((item) => item.id !== member.id))} aria-label={`Remove ${member.name}`}><Trash2 size={13} /></button></div>)}</div>
      </section>

      <aside className="mass-summary"><span className="section-tag">03 · SETTLEMENT</span><h2>Payroll summary</h2><div className="mass-total"><small>TOTAL PAYROLL</small><b>{money(total)} <em>USDC</em></b><p>{members.length} recipient{members.length === 1 ? "" : "s"} · {allocation === "equal" ? "equal allocation" : "custom allocation"}</p></div><label className="funding-label">PAY FROM</label><div className="mass-funding"><button className={funding === "unified_balance" ? "active" : ""} onClick={() => setFunding("unified_balance")}><Network size={16} /><span><b>Unified Balance</b><small>{money(unifiedBalance ?? 0)} USDC confirmed</small></span>{funding === "unified_balance" && <Check size={13} />}</button><button className={funding === "arc_wallet" ? "active" : ""} onClick={() => setFunding("arc_wallet")}><Wallet size={16} /><span><b>Arc wallet</b><small>{money(directBalance ?? 0)} USDC available</small></span>{funding === "arc_wallet" && <Check size={13} />}</button></div><div className="mass-route-note"><Zap size={14} /><div><b>{funding === "arc_wallet" ? "Atomic wallet batch when supported" : "Guided Gateway settlement"}</b><p>{funding === "arc_wallet" ? "App Kit detects EIP-5792 support and safely falls back to sequential transfers." : "Unified Balance executes one real Gateway spend per team member. Gateway fees may apply."}</p></div></div><dl><div><dt>Recipients</dt><dd>{members.length}</dd></div><div><dt>Available</dt><dd>{money(available)} USDC</dd></div><div><dt>Payroll</dt><dd>{money(total)} USDC</dd></div><div><dt>Remaining</dt><dd className={insufficient ? "negative" : ""}>{money(available - total)} USDC</dd></div></dl>{error && <p className="mass-error"><CircleAlert size={13} />{error}</p>}<button className="mass-review-button" disabled={!amountsValid || insufficient} onClick={() => { setError(""); setResult(null); setShowReview(true); }}><span><Send size={17} /></span><div><small>FINAL CHECK</small><b>{insufficient ? "Insufficient balance" : `Review ${members.length} payouts`}</b></div><ArrowRight size={16} /></button><p className="mass-custody"><ShieldCheck size={12} /> You approve every onchain action in your wallet.</p></aside>
    </div>}

    {showReview && <div className="overlay"><article className="mass-review-modal"><button className="modal-x" onClick={() => !busy && setShowReview(false)} disabled={busy}><X size={18} /></button>{result ? <div className={`mass-success ${result.partial ? "partial" : ""}`}><span>{result.partial ? <CircleAlert size={25} /> : <CircleCheck size={25} />}</span><small>{result.partial ? "PAYROLL RUN STOPPED" : "PAYROLL RUN COMPLETE"}</small><h2>{result.txHashes.length} of {members.length} payments submitted.</h2><p>{result.partial ? `Completed transfers were saved and must not be submitted again. ${result.errorMessage ?? "The remaining payouts were not executed."}` : result.mode === "wallet_batch" ? "Your wallet executed the Arc transfers as an EIP-5792 batch." : result.mode === "gateway_sequential" ? "Circle Gateway settled each recipient on Arc." : "The wallet completed each Arc transfer sequentially."}</p><div><span><small>TRANSACTIONS</small><b>{new Set(result.txHashes).size}</b></span><span><small>RECEIPTS SAVED</small><b>{result.receiptsSaved}/{result.txHashes.length}</b></span><span><small>SETTLED</small><b>{result.txHashes.length}/{members.length}</b></span></div><button className="neon-button" onClick={copyRun}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Transaction IDs copied" : "Copy transaction IDs"}</button>{result.explorerUrls[0] && <a href={result.explorerUrls[0]} target="_blank" rel="noreferrer">Open first transaction <ExternalLink size={12} /></a>}<button className="mass-done" onClick={() => { setShowReview(false); if (!result.partial) setMembers([]); setResult(null); }}>Done</button></div> : <><span className="section-tag">REVIEW PAYROLL RUN</span><h2>{money(total)} USDC to {members.length} wallets.</h2><p>Confirm the final manifest. Onchain transfers cannot be edited or reversed after signing.</p><div className="mass-review-list">{payableMembers.map((member) => <div key={member.id}><span><b>{member.name}</b><small>{shortAddress(member.address)}</small></span><strong>{money(member.amount)} USDC</strong></div>)}</div><div className="mass-review-route"><span>{funding === "arc_wallet" ? <Wallet size={15} /> : <Network size={15} />}</span><div><small>SETTLEMENT ROUTE</small><b>{funding === "arc_wallet" ? "Arc wallet batch" : "Circle Unified Balance"}</b></div><em>{members.length} PAYOUTS</em></div>{busy && <div className="mass-progress"><div><span style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 8}%` }} /></div><p><LoaderCircle className="spin" size={13} /> {progress.completed ? `${progress.completed} of ${progress.total} confirmed` : "Waiting for wallet approval…"}</p></div>}{error && <p className="mass-error"><CircleAlert size={13} />{error}</p>}<button className="neon-button mass-execute" onClick={execute} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}<span>{busy ? "Payroll is settling…" : "Approve & execute payroll"}</span>{!busy && <ArrowRight size={15} />}</button><small className="mass-final-note"><ShieldCheck size={11} /> Recipient wallets and amounts are validated before execution.</small></>}</article></div>}
  </section>;
}
