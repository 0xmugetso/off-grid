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

    const apiKey = process.env.MOONPAY_PUBLISHABLE_KEY || "pk_test_OWZro01Zdmvdj004AvidYR7HwYPtEtlr";
    const hasSecretKey = Boolean(process.env.MOONPAY_SECRET_KEY);
    const secretKey = process.env.MOONPAY_SECRET_KEY || "";

    const walletAddress = body.walletAddress || user.walletAddress || "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
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

    let signature = "";
    let signedUrl = urlToSign;

    if (hasSecretKey && secretKey) {
      signature = crypto
        .createHmac("sha256", secretKey)
        .update(`?${queryString}`)
        .digest("base64");
      signedUrl = `${urlToSign}&signature=${encodeURIComponent(signature)}`;
    }

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
