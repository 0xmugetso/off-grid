import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function validSignature(payload: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(request: Request) {
  const payload = await request.text();
  const secret = process.env.PAYOUT_WEBHOOK_SECRET;
  const signature = request.headers.get("x-offgrid-signature") ?? "";

  if (!secret) {
    return NextResponse.json({ accepted: false, error: "Payout webhook provider is not configured" }, { status: 503 });
  }

  if (!validSignature(payload, signature, secret)) {
    return NextResponse.json({ accepted: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  try {
    const event = JSON.parse(payload) as { id?: string; type?: string; payoutId?: string };
    if (!event.id || !event.type) {
      return NextResponse.json({ accepted: false, error: "Malformed payout event" }, { status: 400 });
    }

    // Production: persist the provider event id with a unique constraint, then
    // advance the payout state in the same database transaction.
    return NextResponse.json({ accepted: true, eventId: event.id });
  } catch {
    return NextResponse.json({ accepted: false, error: "Invalid JSON" }, { status: 400 });
  }
}
