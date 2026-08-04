import { NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase, publicUser } from "@/lib/server/store";

export async function PATCH(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { walletAddress?: string | null };
  const walletAddress = body.walletAddress === null ? null : body.walletAddress;
  if (typeof walletAddress === "string" && !isAddress(walletAddress)) return NextResponse.json({ error: "Invalid EVM wallet address" }, { status: 400 });
  const user = await mutateDatabase((database) => {
    const target = database.users.find((entry) => entry.id === current.id);
    if (!target) throw new Error("Account not found");
    target.walletAddress = typeof walletAddress === "string" ? getAddress(walletAddress) : "";
    return publicUser(target);
  });
  return NextResponse.json({ user });
}
