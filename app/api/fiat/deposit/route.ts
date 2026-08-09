import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "Local fiat balance funding is disabled; use a configured Circle Mint or on-ramp provider" }, { status: 410 });
}
