import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      fiatAmount?: string;
    };

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const publishableKey = process.env.STRIPE_ONRAMP_PUBLISHABLE_KEY?.trim();
    if (!stripeSecretKey || !publishableKey) {
      return NextResponse.json({ error: "Stripe Crypto On-Ramp is not configured for this environment" }, { status: 503 });
    }
    const walletAddress = body.walletAddress || user.walletAddress;
    if (!walletAddress || !isAddress(walletAddress)) throw new Error("Connect a valid EVM wallet before opening Stripe On-Ramp");
    const fiatAmount = body.fiatAmount || "100.00";

    const stripeApiPayload = new URLSearchParams({
      destination_currency: "usdc",
      destination_network: "ethereum",
      "wallet_addresses[ethereum]": walletAddress,
      source_currency: "usd",
      source_amount: fiatAmount,
    });
    const stripeResponse = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${stripeSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: stripeApiPayload,
      signal: AbortSignal.timeout(15_000),
    });
    const stripeData = await stripeResponse.json() as { id?: string; client_secret?: string; error?: { message?: string } };
    if (!stripeResponse.ok || !stripeData.id || !stripeData.client_secret) {
      throw new Error(stripeData.error?.message || `Stripe On-Ramp session failed with HTTP ${stripeResponse.status}`);
    }

    return NextResponse.json({
      success: true,
      sessionId: stripeData.id,
      clientSecret: stripeData.client_secret,
      publishableKey,
      walletAddress,
      fiatAmount,
      stripeApiPayload: Object.fromEntries(stripeApiPayload.entries()),
      endpoint: "https://api.stripe.com/v1/crypto/onramp_sessions",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create Stripe Crypto On-Ramp session" },
      { status: 502 }
    );
  }
}
