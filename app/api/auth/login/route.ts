import { NextResponse } from "next/server";
import { authenticateUser, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";

export async function POST(request: Request) {
  const body = await request.json() as { login?: string; password?: string };
  const user = await authenticateUser(body.login ?? "", body.password ?? "");
  if (!user) return NextResponse.json({ error: "Invalid username/email or password" }, { status: 401 });
  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
  return response;
}
