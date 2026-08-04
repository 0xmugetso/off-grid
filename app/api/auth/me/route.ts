import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

export async function GET() {
  return NextResponse.json({ user: await getCurrentUser() });
}
