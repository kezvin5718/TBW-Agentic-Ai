import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { MODEL_SMART, MODEL_FAST, MODEL_CHATGPT } from "@/lib/llm-config";
import { imageModelName } from "@/lib/integrations/openai-images";
import { ENGINES, type EngineConfigKey } from "@/lib/engine-registry";

export const dynamic = "force-dynamic";

/**
 * The model name a config key resolves to *on this server, right now*.
 *
 * Resolved here rather than shipped as a constant to the browser because that
 * is the whole point: the founder is looking at what the running process would
 * actually call, env vars included, not at what someone once wrote down.
 */
function resolveModel(key: EngineConfigKey): string {
  switch (key) {
    case "MODEL_SMART":
      return MODEL_SMART;
    case "MODEL_FAST":
      return MODEL_FAST;
    case "MODEL_CHATGPT":
      return MODEL_CHATGPT;
    // Same default logic generateBrandImage() uses, borrowed from the module
    // itself so the two can never drift apart.
    case "IMAGE_MODEL env":
      return imageModelName();
    case "OPENAI_API_KEY (Whisper)":
      return "whisper-1";
    // describeImageViaVision() picks its model from which key is present.
    case "hardcoded in openai-images.ts":
      return process.env.OPENAI_API_KEY ? "gpt-4o" : "google/gemini-2.5-flash";
  }
}

/**
 * More than this many calls on an unexpected model is drift, not noise.
 *
 * A handful of stray rows is normal — a caller passing an override, a model
 * name that changed mid-window, an experiment. A steady stream is a stale
 * deploy or an env var nobody remembers setting, and that is the thing worth
 * putting a warning next to.
 */
const DRIFT_THRESHOLD = 3;

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

  // The engine map, with the last 30 days of real traffic hung off each entry.
  // Areas with no calls still come back: a feature that has gone quiet is
  // exactly as interesting as one that is burning money, and a complete map is
  // what makes "which model runs the captions" answerable at a glance.
  const byPurposeRows = new Map<string, LogRow[]>();
  for (const r of logs) {
    const k = r.purpose || "general";
    const list = byPurposeRows.get(k);
    if (list) list.push(r);
    else byPurposeRows.set(k, [r]);
  }

  const engines = ENGINES.map((e) => {
    const mine = e.purposes.flatMap((p) => byPurposeRows.get(p) || []);

    const counts = new Map<string, number>();
    for (const r of mine) counts.set(r.model, (counts.get(r.model) || 0) + 1);
    const models = [...counts.entries()]
      .map(([model, calls]) => ({ model, calls }))
      .sort((a, b) => b.calls - a.calls);

    const configuredModel = resolveModel(e.config);
    const alsoModel = e.alsoConfig ? resolveModel(e.alsoConfig) : null;
    const expected = new Set([configuredModel, ...(alsoModel ? [alsoModel] : [])]);
    const drifted = models.filter((m) => m.calls > DRIFT_THRESHOLD && !expected.has(m.model));

    return {
      area: e.area,
      purposes: e.purposes,
      config: e.config,
      configuredModel,
      alsoConfig: e.alsoConfig ?? null,
      alsoModel,
      alsoNote: e.alsoNote ?? null,
      changeWhere: e.changeWhere,
      source: e.source,
      unmetered: e.unmetered === true,
      calls: mine.length,
      cost: sumCost(mine),
      models,
      mismatch: drifted.length > 0,
      mismatchModels: drifted.map((m) => m.model),
    };
  });

  return NextResponse.json({
    success: true,
    balance,
    balanceError,
    spend: { today: sumCost(today), last7: sumCost(week), last30: sumCost(logs) },
    calls: { today: today.length, last30: logs.length },
    byModel: groupBy((r) => r.model),
    byPurpose: groupBy((r) => r.purpose || "general"),
    byDay,
    engines,
    recent: logs.slice(0, 25),
    trackingSince: logs.length > 0 ? logs[logs.length - 1].created_at : null,
  });
}
