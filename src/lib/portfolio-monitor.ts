/**
 * Founder Zone — free background gatherers (no LLM tokens).
 * Intraday watcher: checks live prices vs the founder's alert rules during
 * market hours and files triggers into the journal as they happen.
 * EOD logger: records portfolio value + per-scrip closes for history/trend.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { ALERTS } from "@/lib/portfolio-config";
import { fetchQuote, fetchHoldings, buildSnapshot } from "@/lib/portfolio-data";

const IST_OFFSET_MIN = 5.5 * 60;

function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
}

/** True between 09:15 and 15:35 IST, Mon-Fri. */
export function isMarketHours(): boolean {
  const ist = istNow();
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 35;
}

/** Every 15 min in market hours: check alert rules, journal new triggers once per day. */
export async function runIntradayWatch(): Promise<{ checked: number; fired: number }> {
  if (!isMarketHours()) return { checked: 0, fired: 0 };
  if (ALERTS.length === 0) return { checked: 0, fired: 0 };

  const supabase = createServiceRoleClient();
  const holdings = await fetchHoldings();
  const nameByTicker: Record<string, string> = {};
  for (const h of holdings) nameByTicker[h.ticker] = h.name;

  const tickers = Array.from(new Set(ALERTS.map((a) => a.ticker)));
  const quotes = Object.fromEntries(
    await Promise.all(tickers.map(async (t) => [t, await fetchQuote(t)] as const))
  );

  let fired = 0;
  for (const a of ALERTS) {
    const q = quotes[a.ticker];
    if (!q) continue;
    const hit = a.type === "above" ? q.price >= a.level : q.price <= a.level;
    if (!hit) continue;

    const title = `🚨 Alert — ${nameByTicker[a.ticker] || a.ticker}: ${a.msg}`;
    // Dedup: only one journal entry per rule per day (day boundary = IST midnight)
    const msSinceIstMidnight = istNow().getTime() % 86400000;
    const todayStartIst = new Date(Date.now() - msSinceIstMidnight).toISOString();
    const { data: existing } = await supabase
      .from("founder_journal")
      .select("id")
      .eq("entry_type", "alert")
      .eq("title", title)
      .gte("created_at", todayStartIst)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const { error } = await supabase.from("founder_journal").insert({
      entry_type: "alert",
      title,
      content: `${nameByTicker[a.ticker] || a.ticker} at ₹${q.price.toFixed(2)} crossed your written rule (${a.type} ₹${a.level}). Rule says: ${a.msg}. Review calmly — this is your rule firing, not a recommendation.`,
    });
    if (!error) fired++;
  }
  return { checked: ALERTS.length, fired };
}

/** 15:45 IST weekdays: store the day's closing portfolio state for history. */
export async function runEodLog(): Promise<{ saved: boolean; totalValue: number }> {
  const snapshot = await buildSnapshot(false);
  const supabase = createServiceRoleClient();

  const perScrip: Record<string, { price: number; account: string; qty: number }> = {};
  for (const h of snapshot.holdings) {
    if (h.unavailable || h.price == null) continue;
    perScrip[`${h.account}|${h.ticker}`] = {
      price: h.price,
      account: h.account,
      qty: h.qty || 0,
    };
  }

  const { error } = await supabase.from("founder_market_log").insert({
    kind: "eod",
    total_value: snapshot.portfolio.totalValue,
    total_cost: snapshot.portfolio.totalCost,
    data: { accounts: snapshot.accounts, scrips: perScrip },
  });
  if (error) throw new Error(`EOD log insert failed: ${error.message}`);
  return { saved: true, totalValue: snapshot.portfolio.totalValue };
}

export interface EodTrendRow {
  logged_at: string;
  total_value: number;
  total_cost: number;
}

/** Last N end-of-day rows, oldest first — for the brief and review desks. */
export async function getEodTrend(limit = 10): Promise<EodTrendRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("founder_market_log")
    .select("logged_at, total_value, total_cost")
    .eq("kind", "eod")
    .order("logged_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || [])
    .map((r) => ({
      logged_at: r.logged_at,
      total_value: Number(r.total_value),
      total_cost: Number(r.total_cost),
    }))
    .reverse();
}

/** Render the trend as compact prompt text (empty string if no history yet). */
export function trendToText(rows: EodTrendRow[]): string {
  if (rows.length === 0) return "";
  const lines = ["PORTFOLIO VALUE TREND (end-of-day, oldest→newest):"];
  for (const r of rows) {
    const d = new Date(r.logged_at).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
    });
    const pnl = r.total_cost ? ((r.total_value - r.total_cost) / r.total_cost) * 100 : 0;
    lines.push(
      `- ${d}: ₹${(r.total_value / 1e5).toFixed(2)}L (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs cost)`
    );
  }
  return lines.join("\n");
}
