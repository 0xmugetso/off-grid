import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { parseUsdc, formatUsdc } from "@/lib/money";
import { createCircleMintSandboxMockWirePayment } from "@/lib/server/circle-mint";
import { mutateDatabase, publicUser } from "@/lib/server/store";

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const bankAccountId = process.env.CIRCLE_MINT_BANK_ACCOUNT_ID?.trim();
    if (!bankAccountId) throw new Error("Circle Mint wire bank account is not configured");
    const body = await request.json() as { amount?: string; memo?: string };
    const requested = String(body.amount ?? "").trim();
    const amount = formatUsdc(parseUsdc(requested || "50.00"));
    const payout = await createCircleMintSandboxMockWirePayment({
      bankAccountId,
      amount,
      memo: String(body.memo ?? "").trim(),
    });
    const updatedUser = await mutateDatabase((database) => {
      const target = database.users.find((entry) => entry.id === current.id);
      if (!target) throw new Error("Account not found");
      target.sandboxFiatBalance = formatUsdc(parseUsdc(target.sandboxFiatBalance) + parseUsdc(amount));
      return publicUser(target);
    });
    return NextResponse.json({
      funding: {
        amount,
        trackingRef: payout.data?.trackingRef ?? null,
        status: payout.data?.status ?? "pending",
      },
      user: updatedUser,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fund sandbox balance" }, { status: 400 });
  }
}
