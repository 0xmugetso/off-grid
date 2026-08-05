"use client";

import React, { useEffect, useState } from "react";
import { CreditCard, ExternalLink, LoaderCircle, ShieldCheck, Sparkles, X } from "lucide-react";

function shortAddress(address: string, size = 5) {
  if (!address || address.length < size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}...${address.slice(-size)}`;
}

export interface FiatOnRampModalProps {
  onClose: () => void;
  walletAddress: string | null;
  onSuccess: (cryptoAmount: string) => void;
}

export function FiatOnRampModal({
  onClose,
  walletAddress,
}: FiatOnRampModalProps) {
  const [provider, setProvider] = useState<"moonpay" | "stripe">("moonpay");
  const [moonpaySignedUrl, setMoonpaySignedUrl] = useState<string>("");
  const [stripeSessionId, setStripeSessionId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const effectiveAddress =
    walletAddress || "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

  useEffect(() => {
    let unmounted = false;

    async function loadWidgetSession() {
      try {
        setLoading(true);
        setError("");

        if (provider === "moonpay") {
          const res = await fetch("/api/fiat/moonpay/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walletAddress: effectiveAddress,
              fiatAmount: "100",
              currencyCode: "usdc",
            }),
          });
          const data = (await res.json()) as { signedUrl?: string; error?: string };
          if (!unmounted) {
            if (data.signedUrl) setMoonpaySignedUrl(data.signedUrl);
            else setError(data.error || "Failed to load MoonPay widget");
          }
        } else if (provider === "stripe") {
          const res = await fetch("/api/fiat/stripe/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walletAddress: effectiveAddress,
              fiatAmount: "100",
            }),
          });
          const data = (await res.json()) as { sessionId?: string; error?: string };
          if (!unmounted) {
            if (data.sessionId) setStripeSessionId(data.sessionId);
            else setError(data.error || "Failed to initialize Stripe session");
          }
        }
      } catch (err) {
        if (!unmounted) {
          setError(err instanceof Error ? err.message : "Failed to load fiat gateway");
        }
      } finally {
        if (!unmounted) setLoading(false);
      }
    }

    void loadWidgetSession();

    return () => {
      unmounted = true;
    };
  }, [provider, effectiveAddress]);

  return (
    <div className="overlay">
      <article className="fiat-onramp-modal ultra-clean-modal">
        <button className="modal-x" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        {/* Top Header & Tabs */}
        <div className="onramp-top-bar">
          <div className="onramp-simple-header">
            <span className="section-tag">ARC FIAT ON-RAMP</span>
            <h2>Buy USDC with Fiat</h2>
            <div className="onramp-target-pill">
              <ShieldCheck size={14} />
              <span>Target Account: <b>{shortAddress(effectiveAddress, 6)}</b></span>
            </div>
          </div>

          <div className="provider-tabs-clean">
            <button
              className={`provider-tab-btn ${provider === "moonpay" ? "active" : ""}`}
              onClick={() => setProvider("moonpay")}
            >
              <span className="tab-badge moonpay">M</span>
              <b>MoonPay</b>
            </button>

            <button
              className={`provider-tab-btn ${provider === "stripe" ? "active" : ""}`}
              onClick={() => setProvider("stripe")}
            >
              <span className="tab-badge stripe">S</span>
              <b>Stripe On-Ramp</b>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="onramp-body-container">
          {loading ? (
            <div className="widget-loading-state">
              <LoaderCircle className="spin" size={28} />
              <p>Loading {provider === "moonpay" ? "MoonPay" : "Stripe"} gateway...</p>
            </div>
          ) : error ? (
            <div className="widget-error-state">
              <p>{error}</p>
            </div>
          ) : provider === "moonpay" ? (
            <div className="moonpay-frame-wrapper">
              <div className="popout-notice-bar">
                <p>If your browser adblocker blocks iframe CORS calls:</p>
                <button
                  type="button"
                  className="popout-btn"
                  onClick={() => window.open(moonpaySignedUrl, "_blank")}
                >
                  Open MoonPay in Window <ExternalLink size={13} />
                </button>
              </div>
              <iframe
                src={moonpaySignedUrl}
                title="MoonPay Sandbox On-Ramp"
                className="moonpay-widget-iframe"
                allow="accelerometer; autoplay; camera; gyroscope; payment"
              />
            </div>
          ) : (
            <div className="stripe-checkout-view">
              <div className="stripe-card-header">
                <div className="tab-badge stripe large">S</div>
                <div>
                  <b>Stripe Crypto On-Ramp</b>
                  <p>Initialized with Session ID: <code>{stripeSessionId}</code></p>
                </div>
              </div>
              <div className="stripe-checkout-box">
                <div>
                  <span>Target Arc Wallet</span>
                  <b>{shortAddress(effectiveAddress, 8)}</b>
                </div>
                <div>
                  <span>Amount</span>
                  <b>$100.00 USD (100 USDC)</b>
                </div>
                <div>
                  <span>Network</span>
                  <b>Arc Testnet</b>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

export default FiatOnRampModal;
