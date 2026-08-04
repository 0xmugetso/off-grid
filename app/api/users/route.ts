import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { queryDatabase } from "@/lib/server/store";

export async function GET(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("query")?.trim().toLowerCase() ?? "";
  if (query.length < 2) return NextResponse.json({ users: [] });
  const users = await queryDatabase((database) => database.users
    .filter((user) => user.id !== current.id && user.walletAddress && (`${user.username} ${user.displayName}`).toLowerCase().includes(query))
    .slice(0, 8)
    .map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, walletAddress: user.walletAddress })));
  return NextResponse.json({ users });
}
