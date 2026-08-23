import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ShieldCheck, Zap } from "lucide-react";
import { queryDatabase } from "@/lib/server/store";
import { SOURCE_CHAINS, type SourceChain } from "@/lib/arc/config";
import { ChainName } from "@/components/chain-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReceiptCodeRain } from "@/components/receipt-code-rain";
import { PublicReceiptActions, PublicReceiptDownload } from "@/components/public-receipt-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const invoice = await queryDatabase((database) => database.invoices.find((entry) => entry.id === id));
  return { title: invoice ? `${invoice.amount} USDC receipt · OffGrid` : "Receipt not found · OffGrid", description: "Cryptographically verifiable payment receipt." };
}

function short(value: string) { return `${value.slice(0, 9)}…${value.slice(-6)}`; }

function fundingLabel(method: "arc_wallet" | "unified_balance" | "cctp_bridge" | "fiat_bank") {
  if (method === "cctp_bridge") return "Circle CCTP V2";
  if (method === "unified_balance") return "Gateway unified balance";
  if (method === "fiat_bank") return "Sandbox fiat ledger";
  return "Direct wallet";
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await queryDatabase((database) => database.invoices.find((entry) => entry.id === id));
  if (!invoice) notFound();
  const sender = await queryDatabase((database) => database.users.find((entry) => entry.id === invoice.senderId));
  const isFiat = invoice.fundingMethod === "fiat_bank";

  return (
    <main className="public-receipt-shell">
      <ReceiptCodeRain />
      <header><a href="/"><span className="og-logo"><i /><i /><i /></span><b>offgrid</b></a><div className="receipt-header-actions"><a className="receipt-back" href="/"><ArrowLeft size={13} /> Back To Dashboard</a><PublicReceiptDownload receiptId="verified-receipt-card" reference={invoice.id} amount={invoice.amount} createdAt={invoice.createdAt} /><span><i /> VERIFIED RECEIPT</span><ThemeToggle /></div></header>
      <article className="public-receipt" id="verified-receipt-card">
        <div className="public-glow"><span><Zap size={25} /></span></div>
        <p className="invoice-status">{isFiat ? "FINALIZED IN SANDBOX LEDGER" : "PAYMENT CONFIRMED"}</p>
        <h1><span>{Number(invoice.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span><em>USDC</em></h1>
        <p>{isFiat ? <>A sandbox fiat transfer from <b>{sender?.displayName ?? "OffGrid user"}</b> to <b>{invoice.recipientLabel}</b>.</> : <>A real testnet transfer from <b>{sender?.displayName ?? "OffGrid user"}</b> to <b>{invoice.recipientLabel}</b>.</>}</p>
        <div className="public-route"><span><small>FROM</small><b>{sender?.displayName ?? "OffGrid user"}</b><em>@{sender?.username ?? "private"}</em></span><i><Zap size={14} /></i><span><small>TO</small><b>{invoice.recipientLabel}</b><em>{isFiat ? "Sandbox ledger" : short(invoice.recipientAddress)}</em></span></div>
        {invoice.memo && <blockquote>“{invoice.memo}”</blockquote>}
        <dl><div><dt>Status</dt><dd><i /> Confirmed</dd></div><div><dt>Network</dt><dd>{isFiat ? "OffGrid Sandbox" : <ChainName chain="Arc_Testnet" size={15}/>}</dd></div><div><dt>Time</dt><dd>{new Date(invoice.createdAt).toLocaleString()}</dd></div><div><dt>Funding</dt><dd>{fundingLabel(invoice.fundingMethod)}</dd></div>{invoice.sourceChain && <div><dt>Source</dt><dd>{SOURCE_CHAINS.includes(invoice.sourceChain as SourceChain) ? <ChainName chain={invoice.sourceChain as SourceChain} size={15}/> : invoice.sourceChain}</dd></div>}<div><dt>Reference</dt><dd>{invoice.id.slice(0, 8).toUpperCase()}</dd></div><div className="receipt-transaction"><dt>Transaction</dt><dd>{invoice.explorerUrl ? <a href={invoice.explorerUrl} target="_blank" rel="noreferrer" title={invoice.txHash}>{short(invoice.txHash)} <ExternalLink size={11} /></a> : <span title={invoice.txHash}>{short(invoice.txHash)}</span>}</dd></div></dl>
        {invoice.bridgeSteps && invoice.bridgeSteps.some((step) => step.explorerUrl) && <div className="public-proof"><small>CCTP PROOF TRAIL</small>{invoice.bridgeSteps.filter((step) => step.explorerUrl).map((step) => <a href={step.explorerUrl} target="_blank" rel="noreferrer" key={`${step.name}-${step.txHash}`}>{step.name}<ExternalLink size={10} /></a>)}</div>}
        <PublicReceiptActions explorerUrl={invoice.explorerUrl} />
        <small className="public-secure"><ShieldCheck size={12} /> {isFiat ? "Receipt data is matched to a confirmed sandbox ledger entry." : "Receipt data is matched to a confirmed transaction hash."}</small>
      </article>
      <footer>OFFGRID PAYMENT PROTOCOL · ARC TESTNET</footer>
    </main>
  );
}
