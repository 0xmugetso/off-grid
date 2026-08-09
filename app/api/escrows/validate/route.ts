import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getCurrentUser } from "@/lib/server/auth";
import { executeEscrowContract } from "@/lib/server/arc-escrow-circle";
import { mutateDatabase, queryDatabase } from "@/lib/server/store";

type ValidationResult = {
  valid: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
};

function configurationError() {
  if (!process.env.OPENAI_API_KEY?.trim()) return "OPENAI_API_KEY is not configured";
  return "";
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let activeEscrowId = "";
  try {
    const missing = configurationError();
    if (missing) return NextResponse.json({ error: missing }, { status: 503 });

    const form = await request.formData();
    const escrowId = String(form.get("escrowId") || "");
    activeEscrowId = escrowId;
    const file = form.get("file");
    if (!escrowId) throw new Error("Escrow agreement ID is required");
    if (!(file instanceof File)) throw new Error("A deliverable image is required");
    if (!file.type.startsWith("image/")) throw new Error("The official validation flow accepts image evidence only");
    if (file.size > 5 * 1024 * 1024) throw new Error("Deliverable evidence must be 5 MB or smaller");

    const item = await queryDatabase((database) => database.escrows.find((entry) => entry.id === escrowId) ?? null);
    if (!item) throw new Error("Escrow agreement not found");
    if (item.providerUserId !== current.id) throw new Error("Only the beneficiary can submit work for validation");
    if (item.status !== "locked") throw new Error("The agreement must be funded and locked before validation");
    if (!item.contractAddress || !item.beneficiaryCircleWalletId) throw new Error("RefundProtocol deployment is incomplete");

    await mutateDatabase((database) => {
      const target = database.escrows.find((entry) => entry.id === escrowId);
      if (!target) return;
      target.status = "validating";
      target.lastError = undefined;
      target.aiVerificationLogs.push(`[${new Date().toISOString()}] Beneficiary submitted ${file.name} for AI vision validation.`);
      target.updatedAt = new Date().toISOString();
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const prompt = `Validate whether the attached deliverable image strictly satisfies every relevant criterion below.

Return only JSON with this exact shape:
{"valid":true,"confidence":"HIGH","reasons":[]}

confidence must be HIGH, MEDIUM, or LOW. reasons must explain every unmet or uncertain visual criterion. Ignore criteria that cannot be evaluated from the submitted image.

Agreement criteria:
${item.specs}`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_ESCROW_MODEL?.trim() || "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${file.type};base64,${bytes.toString("base64")}` } },
        ],
      }],
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("AI validation returned no result");
    const parsed = JSON.parse(content) as Partial<ValidationResult>;
    const result: ValidationResult = {
      valid: parsed.valid === true,
      confidence: parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW" ? parsed.confidence : "LOW",
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 12) : [],
    };
    const accepted = result.valid && result.confidence === "HIGH";

    if (!accepted) {
      const escrow = await mutateDatabase((database) => {
        const target = database.escrows.find((entry) => entry.id === escrowId)!;
        target.status = "locked";
        target.deliverableProof = `sha256:${fileHash}`;
        target.validationResult = { ...result, fileName: file.name.slice(0, 120), fileHash };
        target.lastError = "Deliverable did not meet every criterion with HIGH confidence";
        target.aiVerificationLogs.push(`[${new Date().toISOString()}] Validation rejected (${result.confidence}): ${result.reasons.join(" · ") || "criteria not met"}`);
        target.updatedAt = new Date().toISOString();
        return target;
      });
      return NextResponse.json({ error: escrow.lastError, reasons: result.reasons, escrow }, { status: 422 });
    }

    const release = await executeEscrowContract({
      walletId: item.beneficiaryCircleWalletId,
      contractAddress: item.contractAddress,
      signature: "withdraw(uint256[])",
      parameters: [[item.paymentId ?? 0]],
    });
    const escrow = await mutateDatabase((database) => {
      const target = database.escrows.find((entry) => entry.id === escrowId)!;
      target.status = "releasing";
      target.deliverableProof = `sha256:${fileHash}`;
      target.validationResult = { ...result, fileName: file.name.slice(0, 120), fileHash };
      target.releaseTransactionId = release.id;
      target.circleTransactionState = release.state;
      target.lastError = undefined;
      target.aiVerificationLogs.push(`[${new Date().toISOString()}] AI validation passed with HIGH confidence; RefundProtocol withdrawal submitted.`);
      target.updatedAt = new Date().toISOString();
      return target;
    });
    return NextResponse.json({ escrow, validation: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to validate deliverable";
    try {
      if (activeEscrowId) {
        await mutateDatabase((database) => {
          const target = database.escrows.find((entry) => entry.id === activeEscrowId);
          if (!target || target.status !== "validating") return;
          target.status = "locked";
          target.lastError = message;
          target.aiVerificationLogs.push(`[${new Date().toISOString()}] Validation attempt failed: ${message}`);
          target.updatedAt = new Date().toISOString();
        });
      }
    } catch {
      // The original form body may already be consumed. The next GET still
      // reconciles all submitted Circle transactions safely.
    }
    return NextResponse.json({ error: message }, { status: message.includes("Only") ? 403 : 400 });
  }
}
