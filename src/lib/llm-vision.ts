import { MODEL_FAST } from "./llm-config";
import { logUsage } from "./usage-log";

/**
 * Vision completion via OpenRouter (image + text → text). Used by the Content
 * Hub brand-QC. Image is passed as a data URI so it works regardless of where
 * the file is hosted (Drive, Supabase, …).
 */
export async function completeVision({
  system,
  prompt,
  imageDataUrl,
  fileDataUrl,
  fileName,
  model,
  maxTokens,
  purpose,
}: {
  system?: string;
  prompt: string;
  /** Image as a data URI. Give either this or fileDataUrl. */
  imageDataUrl?: string;
  /** A PDF as a data URI (data:application/pdf;base64,…) — Gemini reads these natively. */
  fileDataUrl?: string;
  fileName?: string;
  model?: string;
  maxTokens?: number;
  /** What this call is for, in Credit Logs terms. */
  purpose?: string;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
    return JSON.stringify({ verdict: "unsure", detected_brand: "unknown", reason: "OPENROUTER_API_KEY not set (mock mode)" });
  }

  const attachment = fileDataUrl
    ? { type: "file", file: { filename: fileName || "document.pdf", file_data: fileDataUrl } }
    : { type: "image_url", image_url: { url: imageDataUrl } };

  const messages: Array<Record<string, unknown>> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: prompt },
      attachment,
    ],
  });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital",
      "X-Title": "tbw-os",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: model || MODEL_FAST, messages, max_tokens: maxTokens || 300, usage: { include: true } }),
  });
  if (!res.ok) {
    await logUsage({ model: model || MODEL_FAST, purpose, kind: "vision", ok: false });
    throw new Error(`OpenRouter vision error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  await logUsage({
    model: model || MODEL_FAST,
    purpose,
    kind: "vision",
    promptTokens: data.usage?.prompt_tokens ?? null,
    completionTokens: data.usage?.completion_tokens ?? null,
    cost: data.usage?.cost ?? null,
  });
  return data.choices?.[0]?.message?.content || "";
}
