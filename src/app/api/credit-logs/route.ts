import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface LogRow {
  created_at: string;
  model: string;
  purpose: string;
  kind: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  ok: boolean;
}

/**
 * GET /api/credit-logs — the money page's data, in one call.
 *
 * The balance comes live from OpenRouter's credits endpoint, so nobody has to
 * open their dashboard to know what's left. The breakdowns come from our own
 * llm_usage_logs, because OpenRouter can say what a model cost but not that it
 * was the caption writer rather than the art director spending it.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Live balance. total_credits is lifetime purchases, total_usage lifetime
  // spend; the difference is what is actually left to burn.
  let balance: { totalCredits: number; totalUsage: number; remaining: number } | null = null;
  let balanceError: string | null = null;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.startsWith("mock")) {
    balanceError = "OPENROUTER_API_KEY is not set on the server.";
  } else {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const data = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
      if (!res.ok || !data.data) throw new Error(`OpenRouter answered ${res.status}`);
      const totalCredits = data.data.total_credits ?? 0;
      const totalUsage = data.data.total_usage ?? 0;
      balance = { totalCredits, totalUsage, remaining: totalCredits - totalUsage };
    } catch (err: unknown) {
      balanceError = err instanceof Error ? err.message : String(err);
    }
  }

  const admin = createServiceRoleClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await admin
    .from("llm_usage_logs")
    .select("created_at, model, purpose, kind, prompt_tokens, completion_tokens, cost, ok")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  const logs = (rows || []) as LogRow[];

  const dayMs = 24 * 3600 * 1000;
  const now = Date.now();
  const sumCost = (list: LogRow[]) => list.reduce((s, r) => s + (Number(r.cost) || 0), 0);

  const today = logs.filter((r) => now - new Date(r.created_at).getTime() < dayMs);
  const week = logs.filter((r) => now - new Date(r.created_at).getTime() < 7 * dayMs);

  const groupBy = (key: (r: LogRow) => string) => {
    const map = new Map<string, { calls: number; failed: number; cost: number; tokens: number }>();
    for (const r of logs) {
      const k = key(r);
      const g = map.get(k) || { calls: 0, failed: 0, cost: 0, tokens: 0 };
      g.calls++;
      if (!r.ok) g.failed++;
      g.cost += Number(r.cost) || 0;
      g.tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
      map.set(k, g);
    }
    return [...map.entries()]
      .map(([name, g]) => ({ name, ...g }))
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  };

  // Daily spend for the last 14 days, oldest first, in IST days.
  const byDay: { day: string; cost: number; calls: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const label = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
    byDay.push({ day: label, cost: 0, calls: 0 });
  }
  for (const r of logs) {
    const label = new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
    const slot = byDay.find((d) => d.day === label);
    if (slot) {
      slot.cost += Number(r.cost) || 0;
      slot.calls++;
    }
  }

  return NextResponse.json({
    success: true,
    balance,
    balanceError,
    spend: { today: sumCost(today), last7: sumCost(week), last30: sumCost(logs) },
    calls: { today: today.length, last30: logs.length },
    byModel: groupBy((r) => r.model),
    byPurpose: groupBy((r) => r.purpose || "general"),
    byDay,
    recent: logs.slice(0, 25),
    trackingSince: logs.length > 0 ? logs[logs.length - 1].created_at : null,
  });
}
