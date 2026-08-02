"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, Loader2, Database, Sparkles, HardDrive, Megaphone } from "lucide-react";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector {
  key: string;
  name: string;
  category: string;
  purpose: string;
  mode: Mode;
  detail: string;
}
interface Result {
  connectors: Connector[];
  summary: Record<string, number>;
}

const MODE: Record<Mode, { label: string; dot: string; chip: string }> = {
  live: { label: "Live", dot: "bg-emerald-400", chip: "bg-emerald-950/40 border-emerald-900 text-emerald-400" },
  configured: { label: "Configured — not connected", dot: "bg-sky-400", chip: "bg-sky-950/40 border-sky-900 text-sky-400" },
  simulated: { label: "Simulated (mock)", dot: "bg-amber-400", chip: "bg-amber-950/40 border-amber-900 text-amber-400" },
  offline: { label: "Offline / error", dot: "bg-rose-500", chip: "bg-rose-950/40 border-rose-900 text-rose-400" },
  notbuilt: { label: "Not built yet", dot: "bg-slate-600", chip: "bg-slate-900 border-slate-800 text-slate-500" },
};

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Data: Database,
  AI: Sparkles,
  Storage: HardDrive,
  Publishing: Megaphone,
};

export default function ConnectionsPage() {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = data ? Array.from(new Set(data.connectors.map((c) => c.category))) : [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-indigo-400" />
            <span>Agents Console</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Every external service the system uses — what&apos;s live, what&apos;s simulated, and what&apos;s still to build.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>Refresh</span>
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {(Object.keys(MODE) as Mode[]).map((m) => (
          <span key={m} className="flex items-center space-x-1.5 text-slate-400">
            <span className={`w-2.5 h-2.5 rounded-full ${MODE[m].dot}`} />
            <span>{MODE[m].label}</span>
          </span>
        ))}
      </div>

      {loading && !data ? (
        <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : (
        categories.map((cat) => {
          const Icon = CAT_ICON[cat] || Share2;
          return (
            <div key={cat} className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-2">
                <Icon className="w-4 h-4 text-indigo-400" />
                <span>{cat}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data!.connectors.filter((c) => c.category === cat).map((c) => (
                  <div key={c.key} className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="relative flex shrink-0">
                          {(c.mode === "offline") && <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full ${MODE[c.mode].dot} opacity-60 animate-ping`} />}
                          <span className={`relative w-2.5 h-2.5 rounded-full ${MODE[c.mode].dot}`} />
                        </span>
                        <h3 className="text-sm font-bold text-white truncate">{c.name}</h3>
                      </div>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border shrink-0 ${MODE[c.mode].chip}`}>{MODE[c.mode].label}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">{c.purpose}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{c.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
