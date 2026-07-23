import { MODEL_FAST } from "./llm-config";

export interface LLMMessage {
  role: "user" | "assistant" | "system" | "model";
  content: string;
}

export interface CompleteParams {
  system?: string;
  messages: LLMMessage[];
  jsonSchema?: unknown;
  model?: string;
  maxTokens?: number;
}

/**
 * Utility to strip markdown code fences and clean up JSON string.
 */
export function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  // Strip leading ```json
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  // Strip trailing ```
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

/**
 * Robust JSON parse wrapper that strips markdown code fences,
 * catches parsing errors, logs the raw text on failure, and returns a default value.
 */
export function safeJsonParse<T>(text: string, defaultValue: T): T {
  const cleaned = stripMarkdownFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("❌ Failed to parse LLM JSON response. Error:", err);
    console.error("👉 Raw response was:", text);
    console.error("👉 Cleaned response was:", cleaned);
    return defaultValue;
  }
}

/**
 * Provider-agnostic LLM wrapper function.
 * Connects to OpenRouter completions endpoint, with mock fallback support.
 */
export async function complete({
  system,
  messages,
  jsonSchema,
  model,
  maxTokens,
}: CompleteParams): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  // Mock Fallback Handler
  if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
    console.warn("⚠️ OPENROUTER_API_KEY is not set or is mock. Returning simulated LLM response.");
    
    if (jsonSchema) {
      const sys = system || "";
      if (sys.includes("Classifier") || sys.includes("classification")) {
        return JSON.stringify({ classification: "approval" });
      }
      if (sys.includes("QC") || sys.includes("Quality Control")) {
        return JSON.stringify({
          passed: true,
          checks: [
            { name: "Grammer & Spelling", status: "passed", details: "Grammar and spelling are correct.", cited_source_field: "caption" },
            { name: "Brand Name Accuracy", status: "passed", details: "Brand name spelling matches SWAD Foods.", cited_source_field: "client.name" },
            { name: "Claim Verification", status: "passed", details: "Claims are supported by the brief.", cited_source_field: "brand_brief" },
            { name: "Offer & Address Accuracy", status: "passed", details: "Address details are accurate.", cited_source_field: "addresses" }
          ],
          suggested_corrections: "None."
        });
      }
      if (sys.includes("media") || sys.includes("Media")) {
        return JSON.stringify({
          objective: "OUTCOME_SALES",
          campaign_structure: "1 Campaign -> 2 Adsets -> 4 Ads",
          audience_suggestion: "Busy tech professionals and developers in Bangalore",
          daily_budget_split: "Meta Ads: Rs 1,000/day, Google Search: Rs 500/day",
          expected_cpl_roas_range: "ROAS: 2.2x - 3.0x"
        });
      }
      return JSON.stringify({ status: "success", message: "Mock JSON object response" });
    }

    if (system?.includes("brief")) {
      return "### Brand Core Essence\nSWAD Foods delivers organic, premium spices.\n\n### Copywriting Rules\nTone: direct and encouraging.";
    }
    return "SWAD Foods: Spicing up Bangalore's tech life!";
  }

  // Prepend system prompt if present.
  const openRouterMessages = messages.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  if (system) {
    openRouterMessages.unshift({ role: "system", content: system });
  }

  const body: Record<string, unknown> = {
    model: model || MODEL_FAST,
    messages: openRouterMessages,
    max_tokens: maxTokens || 2000, // Enforce safety token limit to bypass credit reservation checks
  };

  if (jsonSchema) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital",
        "X-Title": "tbw-os",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string;
        };
      }[];
    };

    const text = data.choices?.[0]?.message?.content;
    if (text === undefined || text === null) {
      throw new Error("OpenRouter API returned an empty response content");
    }

    return text;
  } catch (error) {
    console.error("OpenRouter wrapper encountered an error:", error);
    throw error;
  }
}
