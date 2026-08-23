"use client";

import { ArrowLeft, Download, ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { downloadReceiptPng } from "@/lib/download-receipt";

export function PublicReceiptDownload({ receiptId, reference, amount, createdAt }: { receiptId: string; reference: string; amount: string; createdAt: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    const receipt = document.getElementById(receiptId);
    if (!receipt || busy) return;
    setBusy(true);
    try {
      await downloadReceiptPng(receipt, { reference, amount, createdAt });
    } finally {
      setBusy(false);
    }
  }

  return <button className="receipt-download" onClick={() => void download()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />} {busy ? "Creating Image" : "Download Receipt"}</button>;
}

export function PublicReceiptActions({ explorerUrl }: { explorerUrl: string }) {
  return <div className="public-receipt-actions" data-receipt-ignore="true">
    <a href="/"><ArrowLeft size={14} /> Back To Dashboard</a>
    {explorerUrl
      ? <a className="primary" href={explorerUrl} target="_blank" rel="noreferrer">View Onchain Proof <ExternalLink size={14} /></a>
      : <span className="primary disabled" title="This sandbox receipt has no public explorer transaction">Onchain Proof Unavailable</span>}
  </div>;
}
