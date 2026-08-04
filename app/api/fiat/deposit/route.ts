import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { mutateDatabase, publicUser } from "@/lib/server/store";
import { formatUsdc, parseUsdc } from "@/lib/money";

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({})) as { amount?: string };
    const addAmountRaw = parseUsdc(body.amount || "1000");

    const updatedUser = await mutateDatabase((database) => {
      const user = database.users.find((u) => u.id === current.id);
      if (!user) throw new Error("User account not found");

      const currentBalance = parseUsdc(user.sandboxFiatBalance || "0");
      user.sandboxFiatBalance = formatUsdc(currentBalance + addAmountRaw);
      return publicUser(user);
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fund fiat balance" },
      { status: 400 }
    );
  }
}
