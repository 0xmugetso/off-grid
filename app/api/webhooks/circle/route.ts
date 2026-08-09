import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { mutateDatabase } from "@/lib/server/store";

async function circlePublicKey(keyId: string) {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not configured");
  const response = await fetch(`https://api.circle.com/v2/notifications/publicKey/${encodeURIComponent(keyId)}`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Circle public-key request failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: { publicKey?: string } };
  const raw = body.data?.publicKey;
  if (!raw) throw new Error("Circle did not return a notification public key");
  return `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("x-circle-signature");
    const keyId = request.headers.get("x-circle-key-id");
    if (!signature || !keyId) return NextResponse.json({ error: "Missing Circle signature headers" }, { status: 400 });
    const rawBody = await request.text();
    const verifier = crypto.createVerify("SHA256");
    verifier.update(rawBody);
    verifier.end();
    if (!verifier.verify(await circlePublicKey(keyId), Buffer.from(signature, "base64"))) {
      return NextResponse.json({ error: "Invalid Circle webhook signature" }, { status: 403 });
    }

    const payload = JSON.parse(rawBody) as {
      notification?: {
        id?: string;
        state?: string;
        txHash?: string;
        contractAddress?: string;
        errorReason?: string;
      };
    };
    const notification = payload.notification;
    if (!notification?.id) return NextResponse.json({ received: true });

    await mutateDatabase((database) => {
      const escrow = database.escrows.find((item) => [
        item.deploymentTransactionId,
        item.approvalTransactionId,
        item.depositTransactionId,
        item.releaseTransactionId,
        item.refundTransactionId,
      ].includes(notification.id));
      if (!escrow) return;
      escrow.circleTransactionState = notification.state || escrow.circleTransactionState;
      escrow.contractAddress = notification.contractAddress || escrow.contractAddress;
      escrow.lastError = notification.errorReason || escrow.lastError;
      escrow.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Circle webhook failed" }, { status: 500 });
  }
}
