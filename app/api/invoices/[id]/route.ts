import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/server/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await queryDatabase((database) => database.invoices.find((entry) => entry.id === id));
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json({ invoice });
}
