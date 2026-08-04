"use client";

import React, { useState, useEffect } from "react";
import type { Thesis } from "./ThesesJournal";
import {
  Bot,
  Sunrise,
  Scale,
  ShieldAlert,
  FlaskConical,
  Network,
  ClipboardCheck,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";

type AgentKey = "brief" | "debate" | "risk" | "thesis-test" | "correlation" | "review";

interface Field {
  key: string;
  label: string;
  placeholder: string;
  textarea?: boolean;
  required?: boolean;
}

const DESKS: {
  key: AgentKey;
  name: string;
  icon: React.ElementType;
  tagline: string;
  cost: string;
  fields: Field[];
}[] = [
  {
    key: "brief",
    name: "Morning Brief",
    icon: Sunrise,
    tagline: "150-word read of today's live data + your triggered rules",
    cost: "fast model · ~₹0.1/run",
    fields: [],
  },
  {
    key: "correlation",
    name: "Correlation Check",
    icon: Network,
    tagline: "Groups holdings by real economic exposure, flags hidden single bets",
    cost: "smart model · monthly",
    fields: [],
  },
  {
    key: "debate",
    name: "Bull vs Bear",
    icon: Scale,
    tagline: "Two rounds each side + neutral referee. No verdict.",
    cost: "smart model · per idea",
    fields: [
      { key: "ticker", label: "Company / Ticker", placeholder: "e.g. HDFC Bank", required: true },
      {
        key: "data",
        label: "Paste the data (financials, filing extracts, your notes)",
        placeholder: "Revenue, margins, debt, valuation, management commentary…",
        textarea: true,
        required: true,
      },
    ],
  },
  {
    key: "risk",
    name: "Risk Desk",
    icon: ShieldAlert,
    tagline: "Attacks an idea you want to open — checked against live portfolio",
    cost: "smart model · per idea",
    fields: [
      {
        key: "thesis",
        label: "The idea / thesis to attack",
        placeholder: "I want to buy X because…",
        textarea: true,
        required: true,
      },
      {
        key: "data",
        label: "Supporting data (optional)",
        placeholder: "Numbers behind the idea",
        textarea: true,
      },
    ],
  },
  {
    key: "thesis-test",
    name: "Thesis Tester",
    icon: FlaskConical,
    tagline: "Earnings vs your written thesis: intact, damaged, or broken",
    cost: "smart model · at earnings",
    fields: [
      { key: "ticker", label: "Position", placeholder: "e.g. Suzlon Energy" },
      {
        key: "thesis",
        label: "Your written thesis",
        placeholder: "Why you own it, in your own words",
        textarea: true,
        required: true,
      },
      {
        key: "wrongIf",
        label: "Your 'I'm wrong if…' trigger",
        placeholder: "e.g. margins shrink two quarters straight",
        textarea: true,
      },
      {
        key: "results",
        label: "New results / news to test",
        placeholder: "Paste the earnings numbers or event",
        textarea: true,
        required: true,
      },
    ],
  },
  {
    key: "review",
    name: "Performance Review",
    icon: ClipboardCheck,
    tagline: "Reads auto-logged EOD history — process first, results second",
    cost: "smart model · monthly",
    fields: [
      {
        key: "scorecard",
        label: "Extra notes (optional — EOD history loads automatically)",
        placeholder: "Closed positions, benchmark return, process notes…",
        textarea: true,
      },
    ],
  },
];

export default function AgentDesks() {
  const [active, setActive] = useState<AgentKey>("brief");
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [outputDesk, setOutputDesk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTheses, setSavedTheses] = useState<Thesis[]>([]);

  useEffect(() => {
    fetch("/api/founder/theses")
      .then((r) => (r.ok ? r.json() : { theses: [] }))
      .then((j) => setSavedTheses(j.theses || []))
      .catch(() => {});
  }, []);

  const desk = DESKS.find((d) => d.key === active)!;
  const missingRequired = desk.fields.some((f) => f.required && !values[f.key]?.trim());

  const run = async () => {
    setRunning(true);
    setError(null);
    setOutput(null);
    try {
      const res = await fetch("/api/founder/portfolio/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: desk.key, ...values }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setOutput(json.output);
      setOutputDesk(desk.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Bot className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-bold text-white">AI Desks</h2>
        </div>
        <span className="text-[10px] text-slate-500">
          desks analyze · you decide — no desk gives buy/sell calls
        </span>
      </div>

      {/* Desk selector */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2 border-b border-slate-900">
        {DESKS.map((d) => {
          const Icon = d.icon;
          const isActive = d.key === active;
          return (
            <button
              key={d.key}
              onClick={() => {
                setActive(d.key);
                setValues({});
                setError(null);
              }}
              className={`text-left p-3 rounded-xl border transition-all ${
                isActive
                  ? "bg-violet-950/30 border-violet-800/50"
                  : "bg-slate-900/30 border-slate-900 hover:border-slate-800"
              }`}
            >
              <div className="flex items-center space-x-2 mb-1">
                <Icon className={`w-4 h-4 ${isActive ? "text-violet-400" : "text-slate-500"}`} />
                <span className={`text-xs font-bold ${isActive ? "text-white" : "text-slate-300"}`}>
                  {d.name}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-snug">{d.tagline}</p>
            </button>
          );
        })}
      </div>

      {/* Active desk form */}
      <div className="p-5 space-y-4">
        {desk.key === "thesis-test" && savedTheses.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Load a saved thesis
            </label>
            <select
              defaultValue=""
              onChange={(e) => {
                const t = savedTheses.find((s) => s.ticker === e.target.value);
                if (t) {
                  setValues((v) => ({
                    ...v,
                    ticker: t.name || t.ticker,
                    thesis: t.thesis,
                    wrongIf: t.wrong_if,
                  }));
                }
              }}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-800/60"
            >
              <option value="" disabled>
                Pick a position…
              </option>
              {savedTheses.map((t) => (
                <option key={t.ticker} value={t.ticker}>
                  {t.name || t.ticker}
                </option>
              ))}
            </select>
          </div>
        )}
        {desk.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              {f.label}
              {f.required && <span className="text-red-400 ml-1">*</span>}
            </label>
            {f.textarea ? (
              <textarea
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={4}
                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-800/60 resize-y"
              />
            ) : (
              <input
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-800/60"
              />
            )}
          </div>
        ))}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600">{desk.cost}</span>
          <button
            onClick={run}
            disabled={running || missingRequired}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-violet-950/40 border border-violet-800/50 text-sm font-semibold text-violet-300 hover:text-white hover:border-violet-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{running ? "Desk working…" : `Run ${desk.name}`}</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center space-x-2 bg-red-950/30 border border-red-900/50 rounded-xl p-3 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {output && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-2">
              {outputDesk} — output
            </p>
            <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {output}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
