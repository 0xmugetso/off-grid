import { NextResponse } from "next/server";
import { authenticateOrRegisterSiweUser, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      address?: string;
      message?: string;
      signature?: string;
      mode?: "signin" | "register";
      username?: string;
      displayName?: string;
    };

    if (!body.address || !body.message || !body.signature) {
      return NextResponse.json({ error: "Address, SIWE message, and signature are required" }, { status: 400 });
    }

    const user = await authenticateOrRegisterSiweUser({
      address: body.address,
      message: body.message,
      signature: body.signature,
      mode: body.mode,
      username: body.username,
      displayName: body.displayName,
    });

    const response = NextResponse.json({ user }, { status: 200 });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SIWE authentication failed" }, { status: 401 });
  }
}
