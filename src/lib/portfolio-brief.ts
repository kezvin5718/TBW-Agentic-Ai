/**
 * Founder Zone — Morning Brief generator.
 * Used by the on-demand AI desk and the weekday cron. Runs on the fast model
 * to keep the only recurring token spend in the system tiny.
 */

import { complete } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildSnapshot, snapshotToText } from "@/lib/portfolio-data";

export const BRIEF_SYSTEM = `You are the morning-brief desk of a personal "AI hedge fund" for an Indian retail investor. The human is the portfolio manager; you only summarize.
HARD LIMITS: never predict prices or returns; never give buy/sell/hold recommendations or entry/exit signals; only use numbers provided in the prompt; currency is INR (₹). End with one short line: analysis only, not financial advice.`;

export async function generateMorningBrief(): Promise<string> {
  const snapshot = await buildSnapshot(true);
  const prompt =
    "Below is today's raw portfolio audit data. Write a morning brief in under 150 words: " +
    "(1) one-line market read from the data shown, (2) whether any of MY OWN written alert rules triggered and what the rule says, " +
    "(3) at most ONE data point worth watching today — only if the data clearly shows one; do not invent ideas. Be blunt and calm.\n\n" +
    snapshotToText(snapshot);

  return complete({
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    model: MODEL_FAST,
    maxTokens: 500,
  });
}

/** Weekday cron entry: generate the brief and file it in the founder journal. */
export async function runPortfolioMorningBrief(): Promise<{ saved: boolean }> {
  const brief = await generateMorningBrief();
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("founder_journal").insert({
    entry_type: "brief",
    title: `Morning Brief — ${new Date().toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
    })}`,
    content: brief,
  });
  if (error) throw new Error(`Journal insert failed: ${error.message}`);
  return { saved: true };
}
