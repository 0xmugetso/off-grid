import { NextResponse } from "next/server";
import { generateNonce, NONCE_COOKIE, nonceCookieOptions } from "@/lib/server/auth";

export async function GET() {
  const nonce = generateNonce();
  const response = NextResponse.json({ nonce });
  response.cookies.set(NONCE_COOKIE, nonce, nonceCookieOptions);
  return response;
}
