import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "On-ramp completion is provider-webhook driven; local balance credits are disabled" }, { status: 410 });
}
