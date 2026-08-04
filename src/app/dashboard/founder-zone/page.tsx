"use client";

import React, { useState, useEffect, useCallback } from "react";
import AgentDesks from "./AgentDesks";
import ThesesJournal from "./ThesesJournal";
import HoldingsManager, {
  SnapshotHolding,
  AccountSummary,
} from "./HoldingsManager";
import {
  Wallet,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Eye,
  Bell,
  BellOff,
  Newspaper,
  Loader2,
  Lock,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";

interface WatchRow {
  ticker: string;
  name: string;
  unavailable?: boolean;
  price?: number;
  dayPct?: number;
}

interface TriggeredAlert {
  ticker: string;
  name: string;
  price: number;
  level: number;
  type: "above" | "below";
  msg: string;
}

interface PortfolioData {
  asOf: string;
  portfolio: { totalValue: number; totalCost: number; totalPnlPct: number };
  accounts: AccountSummary[];
  holdings: SnapshotHolding[];
  watchlist: WatchRow[];
  alerts: { rules: number; triggered: TriggeredAlert[] };
  news: { query: string; headlines: { title: string; publishedAt: string | null }[] }[];
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const lakh = (n: number) => `₹${(n / 1e5).toFixed(2)}L`;

function PctBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center space-x-1 text-xs font-bold ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      <span>
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}%
      </span>
    </span>
  );
}

export default function FounderZonePage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioData | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/founder/portfolio");
      if (res.status === 403) {
        setError("forbidden");
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-3" />
        <span className="text-sm">Fetching live prices & news…</span>
      </div>
    );
  }

  if (error === "forbidden") {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-3">
        <Lock className="w-10 h-10 text-slate-600 mx-auto" />
        <p className="text-slate-400 font-semibold">Founder access only</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/40 border border-emerald-800/50 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Portfolio Desk</h1>
              <p className="text-xs text-slate-500">
                Founder Zone · monitoring only — the desk watches, you decide
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {data && (
            <span className="text-[10px] text-slate-500">
              as of {new Date(data.asOf).toLocaleTimeString("en-IN")}
            </span>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-sm text-slate-300 hover:text-white hover:border-slate-700 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && error !== "forbidden" && (
        <div className="flex items-center space-x-2 bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Portfolio Value
              </p>
              <p className="text-2xl font-bold text-white">
                {lakh(data.portfolio.totalValue)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                cost {lakh(data.portfolio.totalCost)}
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Overall P&L
              </p>
              <div className="text-2xl font-bold">
                <PctBadge value={data.portfolio.totalPnlPct} />
              </div>
              <p className="text-xs text-slate-500 mt-1">vs average cost</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                Alert Zones
              </p>
              <div className="flex items-center space-x-2">
                {data.alerts.triggered.length > 0 ? (
                  <>
                    <Bell className="w-5 h-5 text-amber-400" />
                    <p className="text-2xl font-bold text-amber-400">
                      {data.alerts.triggered.length}
                    </p>
                  </>
                ) : (
                  <>
                    <BellOff className="w-5 h-5 text-slate-600" />
                    <p className="text-2xl font-bold text-slate-400">0</p>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                of {data.alerts.rules} written rules
              </p>
            </div>
          </div>

          {/* Triggered alerts */}
          {data.alerts.triggered.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-5 space-y-3">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-amber-300">
                  Your rules triggered — review, don&apos;t react
                </h2>
              </div>
              {data.alerts.triggered.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between bg-slate-950/50 border border-amber-900/30 rounded-xl px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-200">{a.name}</p>
                    <p className="text-xs text-amber-300/90 mt-0.5">{a.msg}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-sm font-bold text-white">{inr(a.price)}</p>
                    <p className="text-[10px] text-slate-500">
                      rule: {a.type} {inr(a.level)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Holdings (grouped by account, editable) */}
          <HoldingsManager
            holdings={data.holdings}
            accounts={data.accounts}
            onChanged={() => fetchData(true)}
          />

          {/* Watchlist + News */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-900 flex items-center space-x-2">
                <Eye className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">Watchlist</h2>
              </div>
              <div className="divide-y divide-slate-900/50">
                {data.watchlist.map((w) => (
                  <div key={w.ticker} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{w.name}</p>
                      <p className="text-[10px] text-slate-600">{w.ticker}</p>
                    </div>
                    {w.unavailable ? (
                      <span className="text-xs text-slate-600">unavailable</span>
                    ) : (
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">{inr(w.price!)}</p>
                        <PctBadge value={w.dayPct!} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-900 flex items-center space-x-2">
                <Newspaper className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white">News — last 24h</h2>
              </div>
              <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
                {data.news.length === 0 && (
                  <p className="text-xs text-slate-600">No fresh headlines in window.</p>
                )}
                {data.news.map((n) => (
                  <div key={n.query}>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      {n.query}
                    </p>
                    <ul className="space-y-1.5">
                      {n.headlines.map((h, i) => (
                        <li key={i} className="text-xs text-slate-300 leading-snug">
                          • {h.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Theses + Journal */}
          <ThesesJournal />

          {/* AI Desks */}
          <AgentDesks />

          <p className="text-[10px] text-slate-600 text-center pb-4">
            Prices via Yahoo Finance (may lag ~15 min) · headlines via Google News ·
            not financial advice — alert zones are your own written rules
          </p>
        </>
      )}
    </div>
  );
}
