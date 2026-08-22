import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * One row per model call, so Credit Logs can answer "where is the money
 * going" without opening OpenRouter. OpenRouter reports the exact cost of a
 * chat call when asked (usage.include); image calls may not carry one, and a
 * null cost row still counts the call.
 *
 * Logging must never break the call it describes — a failed insert is
 * swallowed. The one thing this must not do is throw.
 */
export async function logUsage(entry: {
  model: string;
  purpose?: string;
  kind?: "chat" | "vision" | "image";
  promptTokens?: number | null;
  completionTokens?: number | null;
  cost?: number | null;
  ok?: boolean;
}): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    await admin.from("llm_usage_logs").insert({
      model: entry.model,
      purpose: entry.purpose || "general",
      kind: entry.kind || "chat",
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
      cost: entry.cost ?? null,
      ok: entry.ok !== false,
    });
  } catch {
    // Never let bookkeeping take down the work being booked.
  }
}
