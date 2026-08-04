import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { circleMintSandboxStatus } from "@/lib/server/circle-mint";

export async function GET() {
  if (!await getCurrentUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(circleMintSandboxStatus());
}
