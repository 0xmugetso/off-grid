import { NextResponse } from "next/server";
import crypto from "crypto";
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
      currencyCode?: string;
    };

    const apiKey = process.env.MOONPAY_PUBLISHABLE_KEY?.trim();
    const secretKey = process.env.MOONPAY_SECRET_KEY?.trim();
    if (!apiKey || !secretKey) {
      return NextResponse.json({ error: "MoonPay sandbox is not configured for this environment" }, { status: 503 });
    }

    const walletAddress = body.walletAddress || user.walletAddress;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new Error("Connect a valid EVM wallet before opening MoonPay");
    }
    const baseCurrencyAmount = body.fiatAmount || "100";
    const currencyCode = body.currencyCode || "usdc";

    const queryParams = new URLSearchParams({
      apiKey,
      currencyCode,
      walletAddress,
      baseCurrencyCode: "usd",
      baseCurrencyAmount,
      colorCode: "#c7ff3d",
      email: `${user.username || "sandbox"}@offgrid.finance`,
      externalCustomerId: `offgrid-${user.id || "demo"}`,
    });

    const baseUrl = "https://buy-sandbox.moonpay.com";
    const queryString = queryParams.toString();
    const urlToSign = `${baseUrl}?${queryString}`;

    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(`?${queryString}`)
      .digest("base64");
    const signedUrl = `${urlToSign}&signature=${encodeURIComponent(signature)}`;

    return NextResponse.json({
      success: true,
      apiKey,
      urlToSign,
      signature,
      signedUrl,
      targetWallet: walletAddress,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate MoonPay signature" },
      { status: 400 }
    );
  }
}
