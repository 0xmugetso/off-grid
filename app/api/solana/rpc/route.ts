import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

const DEFAULT_SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Invalid Solana RPC request" }, { status: 400 });
  }

  let payload: { method?: string };
  try {
    payload = JSON.parse(rawBody) as { method?: string };
  } catch {
    return NextResponse.json({ error: "Invalid Solana RPC JSON" }, { status: 400 });
  }

  const upstream = process.env.SOLANA_DEVNET_RPC_URL?.trim() || DEFAULT_SOLANA_DEVNET_RPC;
  const attempts = payload.method === "sendTransaction" ? 1 : 2;
  let lastError = "Solana Devnet did not respond";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(upstream, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: rawBody,
        signal: AbortSignal.timeout(12_000),
      });
      const body = await response.text();
      if (response.ok || attempt === attempts - 1) {
        return new NextResponse(body, {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
        });
      }
      lastError = `Solana Devnet returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  return NextResponse.json({ error: { code: -32000, message: lastError } }, { status: 503 });
}
