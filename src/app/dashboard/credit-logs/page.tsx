"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, RefreshCw, TrendingDown, Zap, AlertTriangle } from "lucide-react";

interface Group { name: string; calls: number; failed: number; cost: number; tokens: number }
interface Payload {
  balance: { totalCredits: number; totalUsage: number; remaining: number } | null;
  balanceError: string | null;
  spend: { today: number; last7: number; last30: number };
  calls: { today: number; last30: number };
  byModel: Group[];
  byPurpose: Group[];
  byDay: { day: string; cost: number; calls: number }[];
  recent: { created_at: string; model: string; purpose: string; kind: string; cost: number | null; ok: boolean }[];
  trackingSince: string | null;
}

const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : n >= 1 ? 2 : 4)}`;

/**
 * Credit Logs — the OpenRouter wallet without opening OpenRouter.
 *
 * Balance is live from their API; the breakdowns are our own bookkeeping (one
 * row per model call), which is what lets the page say not just "Sonnet spent
 * $4" but "the 5b art director spent it".
 */
export default function CreditLogsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/credit-logs");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // The point of the page is "don't open OpenRouter to check" — keep the
    // number honest while the tab sits open, without hammering anyone.
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const maxDay = Math.max(...(data?.byDay.map((d) => d.cost) || [0]), 0.0001);
  const maxModel = Math.max(...(data?.byModel.map((m) => m.cost) || [0]), 0.0001);
  const maxPurpose = Math.max(...(data?.byPurpose.map((p) => p.cost) || [0]), 0.0001);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wallet className="w-6 h-6 text-indigo-400" /> Credit Logs
          </h1>
          <p className="text-sm text-slate-400 mt-1">Live OpenRouter balance, and where the credits actually go.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg border bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-indigo-500 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-800/50 bg-red-950/30 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Balance row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-emerald-800/50 bg-emerald-950/20">
          <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Balance left</div>
          <div className="text-3xl font-black text-white mt-1">
            {data?.balance ? usd(data.balance.remaining) : data?.balanceError ? "—" : "…"}
          </div>
          {data?.balanceError && <div className="text-[11px] text-red-400 mt-1">{data.balanceError}</div>}
          {data?.balance && (
            <div className="text-[11px] text-slate-500 mt-1">
              of {usd(data.balance.totalCredits)} purchased · {usd(data.balance.totalUsage)} used lifetime
            </div>
          )}
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Spent today</div>
          <div className="text-3xl font-black text-white mt-1">{data ? usd(data.spend.today) : "…"}</div>
          <div className="text-[11px] text-slate-500 mt-1">{data?.calls.today ?? 0} model call(s)</div>
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Last 7 days</div>
          <div className="text-3xl font-black text-white mt-1">{data ? usd(data.spend.last7) : "…"}</div>
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Last 30 days</div>
          <div className="text-3xl font-black text-white mt-1">{data ? usd(data.spend.last30) : "…"}</div>
          <div className="text-[11px] text-slate-500 mt-1">{data?.calls.last30 ?? 0} call(s) tracked</div>
        </div>
      </div>

      {/* Daily bars */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
        <div className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <TrendingDown className="w-4 h-4 text-indigo-400" /> Daily spend — last 14 days
        </div>
        <div className="flex items-end gap-1.5 h-28">
          {(data?.byDay || []).map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group" title={`${d.day}: ${usd(d.cost)} · ${d.calls} calls`}>
              <div className="text-[9px] text-slate-500 opacity-0 group-hover:opacity-100">{usd(d.cost)}</div>
              <div
                className="w-full rounded-t bg-indigo-500/70 group-hover:bg-indigo-400 min-h-[2px]"
                style={{ height: `${Math.max(2, (d.cost / maxDay) * 80)}px` }}
              />
              <div className="text-[9px] text-slate-600 whitespace-nowrap">{d.day.split(" ")[0]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* By model */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-sm font-bold text-white mb-4">Where it goes — by model (30 days)</div>
          <div className="space-y-3">
            {(data?.byModel || []).slice(0, 10).map((m) => (
              <div key={m.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-mono truncate pr-2">{m.name}</span>
                  <span className="text-white font-bold shrink-0">{usd(m.cost)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (m.cost / maxModel) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {m.calls} call(s){m.failed ? ` · ${m.failed} failed` : ""}{m.tokens ? ` · ${(m.tokens / 1000).toFixed(0)}k tokens` : ""}
                </div>
              </div>
            ))}
            {data && data.byModel.length === 0 && (
              <div className="text-xs text-slate-500">Nothing tracked yet — usage starts recording from the next AI call after this deploy.</div>
            )}
          </div>
        </div>

        {/* By feature */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-sm font-bold text-white mb-4">Where it goes — by feature (30 days)</div>
          <div className="space-y-3">
            {(data?.byPurpose || []).slice(0, 10).map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 truncate pr-2">{p.name}</span>
                  <span className="text-white font-bold shrink-0">{usd(p.cost)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (p.cost / maxPurpose) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{p.calls} call(s){p.failed ? ` · ${p.failed} failed` : ""}</div>
              </div>
            ))}
            {data && data.byPurpose.length === 0 && (
              <div className="text-xs text-slate-500">Nothing tracked yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent calls */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-950">
        <div className="text-sm font-bold text-white flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-amber-400" /> Recent calls
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-3 font-bold">When (IST)</th>
                <th className="py-2 pr-3 font-bold">Feature</th>
                <th className="py-2 pr-3 font-bold">Model</th>
                <th className="py-2 pr-3 font-bold">Type</th>
                <th className="py-2 pr-3 font-bold text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent || []).map((r, i) => (
                <tr key={i} className="border-b border-slate-900 text-slate-300">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-1.5 pr-3">{r.purpose}</td>
                  <td className="py-1.5 pr-3 font-mono text-slate-400">{r.model}</td>
                  <td className="py-1.5 pr-3">{r.kind}</td>
                  <td className={`py-1.5 pr-3 text-right font-bold ${r.ok ? "text-white" : "text-red-400"}`}>
                    {r.ok ? (r.cost != null ? usd(Number(r.cost)) : "—") : "failed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.recent.length === 0 && (
            <div className="text-xs text-slate-500 py-3">No calls tracked yet — this fills up as the portal works.</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-600">
        Balance is live from OpenRouter. Per-model and per-feature numbers are tracked by this portal from each call&apos;s
        reported cost, so history begins from the day this page was installed. Amounts are in US dollars, matching OpenRouter credits.
      </p>
    </div>
  );
}
