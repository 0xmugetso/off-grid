import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { analyzeEscrowDocument } from "@/lib/server/escrow-ai";

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Upload a PDF, DOCX, or image agreement");
    if (file.size > 10 * 1024 * 1024) throw new Error("Agreement must be 10 MB or smaller");
    const supported = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/webp"];
    if (!supported.includes(file.type)) throw new Error("Supported agreement formats are PDF, DOCX, PNG, JPG, and WEBP");
    const bytes = Buffer.from(await file.arrayBuffer());
    const terms = await analyzeEscrowDocument({ bytes, mimeType: file.type });
    return NextResponse.json({ terms, fileName: file.name.slice(0, 120), fileHash: createHash("sha256").update(bytes).digest("hex") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to analyze agreement" }, { status: 400 });
  }
}
