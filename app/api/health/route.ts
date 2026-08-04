import { NextResponse } from "next/server";
import { persistenceMode, queryDatabase } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    if (process.env.NODE_ENV === "production" && persistenceMode() !== "postgres") {
      throw new Error("Hosted Postgres is not configured");
    }
    if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
      throw new Error("SESSION_SECRET is not configured");
    }
    await queryDatabase(() => true);
    return NextResponse.json({
      ok: true,
      service: "offgrid",
      version: "0.2.0",
      environment: process.env.NODE_ENV,
      persistence: persistenceMode(),
      arc: process.env.NEXT_PUBLIC_ARC_NETWORK ?? "Arc_Testnet",
      fiatSandboxConfigured: Boolean(process.env.CIRCLE_MINT_API_KEY && process.env.CIRCLE_MINT_BANK_ACCOUNT_ID),
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      service: "offgrid",
      error: process.env.NODE_ENV === "production" ? "Required production configuration is missing" : error instanceof Error ? error.message : "Health check failed",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
