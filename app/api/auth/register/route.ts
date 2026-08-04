import { NextResponse } from "next/server";
import { createSessionToken, createUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; username?: string; displayName?: string; password?: string };
    const user = await createUser({ email: body.email ?? "", username: body.username ?? "", displayName: body.displayName ?? "", password: body.password ?? "" });
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create account" }, { status: 400 });
  }
}
