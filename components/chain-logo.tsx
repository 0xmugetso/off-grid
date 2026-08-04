"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { CHAIN_LABELS, type SourceChain } from "@/lib/arc/config";

export function ChainLogo({ chain, size = 28, className = "" }: { chain: SourceChain; size?: number; className?: string }) {
  const gradientId = useId().replaceAll(":", "");
  const common = { width: size, height: size, viewBox: "0 0 32 32", role: "img", "aria-label": `${CHAIN_LABELS[chain]} logo` } as const;

  if (chain === "Base_Sepolia") return <svg {...common} className={`chain-logo ${className}`}><circle cx="16" cy="16" r="15" fill="#0052ff"/><path d="M15.7 24.1a8.1 8.1 0 1 1 7.7-10.6h-4a4.4 4.4 0 1 0 0 5h4a8.1 8.1 0 0 1-7.7 5.6Z" fill="#fff"/></svg>;
  if (chain === "Arbitrum_Sepolia") return <svg {...common} className={`chain-logo ${className}`}><path d="m16 1.5 12.4 7.1v14.3L16 30 3.6 22.9V8.6L16 1.5Z" fill="#213147" stroke="#6da9db"/><path d="m13.2 23.8-3-2.1 6.7-15 3.5 2-7.2 15.1Z" fill="#28a0f0"/><path d="m19.1 25.1-3.1-1.8 6.4-13.4 3 1.7-6.3 13.5Z" fill="#96bedc"/><path d="m8 19.8-1.8-1.2 4.7-10.1 3 1.7L8 19.8Z" fill="#fff"/></svg>;
  if (chain === "Ethereum_Sepolia") return <svg {...common} className={`chain-logo ${className}`}><circle cx="16" cy="16" r="15" fill="#627eea"/><path d="m16 4.7-7 11.6 7 4.1 7-4.1L16 4.7Z" fill="#fff" fillOpacity=".9"/><path d="m16 21.8-7-4.1L16 27.4l7-9.7-7 4.1Z" fill="#fff" fillOpacity=".68"/><path d="m16 12.9-7 3.4 7 4.1 7-4.1-7-3.4Z" fill="#263a80" fillOpacity=".34"/></svg>;
  if (chain === "Solana_Devnet") return <svg {...common} className={`chain-logo ${className}`}><defs><linearGradient id={`sol-${gradientId}`} x1="5" y1="27" x2="27" y2="5" gradientUnits="userSpaceOnUse"><stop stopColor="#9945ff"/><stop offset="1" stopColor="#14f195"/></linearGradient></defs><circle cx="16" cy="16" r="15" fill="#080a0b" stroke="#272b2d"/><path d="M9 8h16l-3 3H6l3-3Zm-3 7h16l3 3H9l-3-3Zm3 7h16l-3 3H6l3-3Z" fill={`url(#sol-${gradientId})`}/></svg>;
  // Arc's official mark is a solid architectural arch, rendered here in the
  // product's monochrome chain-chip treatment rather than the old orbit glyph.
  return <svg {...common} className={`chain-logo arc-chain-logo ${className}`}><rect x="1" y="1" width="30" height="30" rx="9" fill="#0a0c0b" stroke="#343a35"/><path d="M6.2 24.8v-9.2C6.2 8.8 10.5 4 16 4s9.8 4.8 9.8 11.6v9.2h-5.1v-9.1c0-3.5-2-6.2-4.7-6.2s-4.7 2.7-4.7 6.2v9.1H6.2Z" fill="#f4f6f2"/><path d="M10.9 19.6h10.2v5.2H10.9z" fill="#0a0c0b"/></svg>;
}

export function ChainName({ chain, size = 18, className = "" }: { chain: SourceChain; size?: number; className?: string }) {
  return <span className={`chain-name ${className}`}><ChainLogo chain={chain} size={size}/><span>{CHAIN_LABELS[chain]}</span></span>;
}

export function ChainSelect({ value, chains, onChange, eyebrow, className = "" }: { value: SourceChain; chains: readonly SourceChain[]; onChange: (chain: SourceChain) => void; eyebrow?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div className={`chain-select ${open ? "open" : ""} ${className}`} ref={rootRef}>
    <button type="button" className="chain-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <ChainLogo chain={value} size={28}/><span>{eyebrow && <small>{eyebrow}</small>}<b>{CHAIN_LABELS[value]}</b></span><ChevronDown size={13}/>
    </button>
    {open && <div className="chain-select-menu" role="listbox" aria-label="Select source chain">
      {chains.map((chain) => <button type="button" role="option" aria-selected={chain === value} className={chain === value ? "active" : ""} key={chain} onClick={() => { onChange(chain); setOpen(false); }}><ChainLogo chain={chain} size={25}/><span><b>{CHAIN_LABELS[chain]}</b><small>{chain === "Solana_Devnet" ? "SVM · TESTNET" : "EVM · TESTNET"}</small></span>{chain === value && <i />}</button>)}
    </div>}
  </div>;
}
