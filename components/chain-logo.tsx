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
  return <svg {...common} viewBox="0 0 164 171" preserveAspectRatio="xMidYMid meet" className={`chain-logo arc-chain-logo ${className}`}><path d="M0 171C1.39327 129.136 8.52567 90.067 20.4481 59.6871C35.5477 21.1972 57.4057 0 81.9919 0C106.578 0 128.433 21.1972 143.536 59.6871C151.391 79.7058 157.17 103.491 160.594 129.366C160.9 131.677 161.161 134.026 161.428 136.369C161.515 136.514 161.568 136.649 161.55 136.758C161.55 136.758 163.562 149.265 163.99 171H163.763C160.778 168.562 125.578 141.038 67.2282 149.007C68.1086 139.181 69.3194 129.62 70.8835 120.456C70.9634 119.987 71.0558 119.535 71.1373 119.07C94.0233 118.383 114.055 121.028 129.416 124.494C129.359 124.131 129.311 123.758 129.253 123.397C126.095 103.83 121.437 85.9161 115.43 70.6073C105.61 45.576 92.7953 30.0239 81.9919 30.0239C71.189 30.0239 58.3744 45.576 48.554 70.6073C46.1769 76.6621 44.0128 83.1192 42.0721 89.9301C39.3438 99.4735 37.0517 109.704 35.2212 120.455C32.5117 136.331 30.8189 153.358 30.1954 171H0Z" fill="currentColor"/></svg>;
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
