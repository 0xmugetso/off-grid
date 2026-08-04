import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Password authentication is disabled. Please use SIWE (Sign-In With Wallet) at /api/auth/siwe" },
    { status: 400 }
  );
}
