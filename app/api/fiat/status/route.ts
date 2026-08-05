import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { circleMintSandboxStatus, fetchCircleMintBalances } from "@/lib/server/circle-mint";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseStatus = circleMintSandboxStatus();
  const balances = await fetchCircleMintBalances();

  return NextResponse.json({
    ...baseStatus,
    realCircleBalance: balances,
  });
}
