import "server-only";

export type EscrowVisionResult = {
  valid: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
};

export type EscrowTerms = {
  title: string;
  category: "code" | "digital_goods" | "api_key" | "freelance";
  amount: string;
  paymentFor: string;
  summary: string;
  criteria: string;
  dueDate?: string;
  tasks: Array<{ description: string; dueDate?: string; responsibleParty?: string; additionalDetails?: string }>;
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

const termsSchema = {
  type: "object",
  properties: {
    title: { type: "string" }, category: { type: "string", enum: ["code", "digital_goods", "api_key", "freelance"] },
    amount: { type: "string" }, paymentFor: { type: "string" }, summary: { type: "string" }, criteria: { type: "string" }, dueDate: { type: "string" },
    tasks: { type: "array", items: { type: "object", properties: { description: { type: "string" }, dueDate: { type: "string" }, responsibleParty: { type: "string" }, additionalDetails: { type: "string" } }, required: ["description"] } },
  }, required: ["title", "category", "amount", "paymentFor", "summary", "criteria", "tasks"],
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

function normalizeTerms(value: unknown): EscrowTerms {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<EscrowTerms>;
  const category = parsed.category === "digital_goods" || parsed.category === "api_key" || parsed.category === "freelance" ? parsed.category : "code";
  return {
    title: String(parsed.title || "Untitled agreement").slice(0, 100), category,
    amount: String(parsed.amount || "0"), paymentFor: String(parsed.paymentFor || "").slice(0, 500), summary: String(parsed.summary || "").slice(0, 1000),
    criteria: String(parsed.criteria || "").slice(0, 2000), dueDate: parsed.dueDate ? String(parsed.dueDate).slice(0, 80) : undefined,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => ({ description: String(task.description || "").slice(0, 400), dueDate: task.dueDate ? String(task.dueDate).slice(0, 80) : undefined, responsibleParty: task.responsibleParty ? String(task.responsibleParty).slice(0, 120) : undefined, additionalDetails: task.additionalDetails ? String(task.additionalDetails).slice(0, 500) : undefined })).filter((task) => task.description).slice(0, 20) : [],
  };
}

export async function analyzeEscrowDocument(input: { bytes: Buffer; mimeType: string }): Promise<EscrowTerms> {
  const config = escrowAiConfiguration();
  if (!config.configured) throw new Error(`${config.missing[0]} is not configured`);
  const prompt = `Extract a payment agreement into JSON. Identify the title, category, total USDC amount, what the payment is for, a concise summary, objective acceptance criteria, due date, and every deliverable/task. Never invent missing values; use an empty string or 0. Return only the requested JSON schema.`;
  if (config.provider === "gemini") {
    const inputType = input.mimeType.startsWith("image/") ? "image" : "document";
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! }, body: JSON.stringify({ model: config.model, input: [{ type: "text", text: prompt }, { type: inputType, data: input.bytes.toString("base64"), mime_type: input.mimeType }], response_format: { type: "text", mime_type: "application/json", schema: termsSchema } }) });
    const payload = await response.json() as { output_text?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `Gemini analysis failed (${response.status})`);
    return normalizeTerms(extractGeminiText(payload));
  }
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({ model: config.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}` } }] as never }] });
  return normalizeTerms(response.choices[0]?.message.content || "{}");
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
