import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase } from "@/lib/server/store";
import { parseUsdc, formatUsdc } from "@/lib/money";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as {
      provider?: string;
      fiatAmount?: string;
      cryptoAmount?: string;
      walletAddress?: string;
      paymentMethod?: string;
      txHash?: string;
    };

    const provider = body.provider || "moonpay";
    const fiatAmount = body.fiatAmount || "100.00";
    const cryptoAmount = body.cryptoAmount || fiatAmount;
    const walletAddress = body.walletAddress || user.walletAddress;

    if (!walletAddress) {
      throw new Error("No connected wallet address provided for on-ramp settlement");
    }

    const amountRaw = parseUsdc(cryptoAmount);
    if (amountRaw <= 0n) {
      throw new Error("On-ramp amount must be greater than 0");
    }

    // Record the fiat on-ramp settlement in the user's database session
    const updatedUser = await mutateDatabase((db) => {
      const dbUser = db.users.find((u) => u.id === user.id);
      if (!dbUser) throw new Error("User not found");

      // Credit the user's sandbox fiat balance
      const currentFiat = parseUsdc(dbUser.sandboxFiatBalance || "0");
      dbUser.sandboxFiatBalance = formatUsdc(currentFiat + amountRaw);

      return dbUser;
    });

    return NextResponse.json({
      success: true,
      provider,
      fiatAmount,
      cryptoAmount,
      walletAddress,
      settlementTxHash: body.txHash || `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
      newFiatBalance: updatedUser.sandboxFiatBalance,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process fiat on-ramp" },
      { status: 400 }
    );
  }
}
