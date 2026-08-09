import "server-only";

export type EscrowVisionResult = {
  valid: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
};

const schema = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["valid", "confidence", "reasons"],
};

export function escrowAiConfiguration() {
  const provider = (process.env.ESCROW_AI_PROVIDER?.trim().toLowerCase() || "gemini") as "gemini" | "openai";
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const configured = provider === "gemini" ? geminiConfigured : openAiConfigured;
  return {
    provider,
    configured,
    missing: configured ? [] : [provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"],
    model: provider === "gemini"
      ? process.env.GEMINI_ESCROW_MODEL?.trim() || "gemini-3.6-flash"
      : process.env.OPENAI_ESCROW_MODEL?.trim() || "gpt-4o",
  };
}

function normalize(value: unknown): EscrowVisionResult {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<EscrowVisionResult>;
  return {
    valid: parsed.valid === true,
    confidence: parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW" ? parsed.confidence : "LOW",
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 12) : [],
  };
}

function extractGeminiText(payload: { output_text?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }) {
  if (payload.output_text) return payload.output_text;
  return payload.steps?.flatMap((step) => step.content || []).find((part) => part.type === "text")?.text || "";
}

export async function validateEscrowImage(input: { prompt: string; bytes: Buffer; mimeType: string }): Promise<EscrowVisionResult> {
  const config = escrowAiConfiguration();
  if (!config.configured) throw new Error(`${config.missing[0]} is not configured`);

  if (config.provider === "gemini") {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        model: config.model,
        input: [
          { type: "text", text: input.prompt },
          { type: "image", data: input.bytes.toString("base64"), mime_type: input.mimeType },
        ],
        response_format: { type: "text", mime_type: "application/json", schema },
      }),
    });
    const payload = await response.json() as { output_text?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `Gemini validation failed (${response.status})`);
    const content = extractGeminiText(payload);
    if (!content) throw new Error("Gemini validation returned no result");
    return normalize(content);
  }

  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}` } }] }],
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI validation returned no result");
  return normalize(content);
}
