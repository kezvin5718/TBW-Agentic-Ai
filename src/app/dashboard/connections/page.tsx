"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, Loader2 } from "lucide-react";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector { key: string; name: string; category: string; purpose: string; mode: Mode; detail: string }

const COLOR: Record<Mode, string> = {
  live: "#34d399",
  configured: "#38bdf8",
  simulated: "#fbbf24",
  offline: "#f43f5e",
  notbuilt: "#64748b",
};
const MODE_LABEL: Record<Mode, string> = {
  live: "Live",
  configured: "Ready to connect",
  simulated: "Simulated",
  offline: "Offline",
  notbuilt: "Not built",
};

// Layout: left → right pipeline. y-centres per node.
const NODES: { id: string; key: string; label: string; sub: string; x: number; y: number }[] = [
  { id: "brain", key: "supabase_db", label: "Client & Planning", sub: "Supabase DB", x: 120, y: 310 },
  { id: "openrouter", key: "openrouter", label: "OpenRouter", sub: "AI Text", x: 480, y: 130 },
  { id: "higgsfield", key: "higgsfield", label: "Higgsfield", sub: "AI Images", x: 480, y: 310 },
  { id: "openai", key: "openai", label: "OpenAI", sub: "Image / Voice", x: 480, y: 490 },
  { id: "drive", key: "google_drive", label: "Google Drive", sub: "Storage", x: 840, y: 220 },
  { id: "supastore", key: "supabase_storage", label: "Supabase", sub: "Storage", x: 840, y: 400 },
  { id: "meta", key: "meta", label: "Meta", sub: "Instagram / FB", x: 1160, y: 220 },
  { id: "whatsapp", key: "whatsapp", label: "WhatsApp", sub: "Approvals", x: 1160, y: 400 },
  { id: "live", key: "meta", label: "Posted Live", sub: "Social feed", x: 1380, y: 310 },
];
const EDGES: [string, string][] = [
  ["brain", "openrouter"], ["brain", "higgsfield"], ["brain", "openai"],
  ["higgsfield", "drive"], ["openai", "drive"], ["higgsfield", "supastore"],
  ["openrouter", "meta"], ["drive", "meta"], ["drive", "whatsapp"],
  ["meta", "live"], ["whatsapp", "live"],
];

const NW = 168, NH = 60;

export default function AgentsConsolePage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const modeOf = (key: string): Mode => (connectors.find((c) => c.key === key)?.mode as Mode) || "notbuilt";
  const detailOf = (key: string): string => connectors.find((c) => c.key === key)?.detail || "";
  const nodeById = (id: string) => NODES.find((n) => n.id === id)!;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-indigo-400" />
            <span>Agents Console</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">The whole system, left to right. Neon lights flow where it&apos;s working; the colour tells you the status.</p>
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
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
        {(Object.keys(COLOR) as Mode[]).map((m) => (
          <span key={m} className="flex items-center space-x-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR[m], boxShadow: `0 0 6px ${COLOR[m]}` }} />
            <span>{MODE_LABEL[m]}</span>
          </span>
        ))}
      </div>

      {/* Flow diagram */}
      <div className="bg-slate-950/50 border border-slate-900 rounded-3xl p-4 overflow-x-auto">
        <svg viewBox="0 0 1500 620" className="w-full" style={{ minWidth: 900 }}>
          <style>{`
            .ac-flow { fill:none; stroke-width:2.4; stroke-linecap:round; stroke-dasharray:9 22; animation: ac-dash 1s linear infinite; }
            @keyframes ac-dash { to { stroke-dashoffset: -31; } }
            .ac-node { transition: all .3s; }
          `}</style>

          {/* Edges: dim wire underlay + animated neon overlay */}
          {EDGES.map(([from, to], i) => {
            const s = nodeById(from), t = nodeById(to);
            const sx = s.x + NW / 2, sy = s.y, tx = t.x - NW / 2, ty = t.y;
            const d = `M ${sx} ${sy} C ${sx + 110} ${sy}, ${tx - 110} ${ty}, ${tx} ${ty}`;
            const mode = modeOf(s.key);
            const col = COLOR[mode];
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={col} strokeWidth={2.4} opacity={0.12} />
                <path d={d} className="ac-flow" stroke={col} style={{ filter: `drop-shadow(0 0 4px ${col})` }} />
              </g>
            );
          })}

          {/* Nodes */}
          {NODES.map((n) => {
            const mode = modeOf(n.key);
            const col = COLOR[mode];
            const x = n.x - NW / 2, y = n.y - NH / 2;
            return (
              <g key={n.id} className="ac-node">
                <title>{`${n.label} — ${MODE_LABEL[mode]}\n${detailOf(n.key)}`}</title>
                <rect x={x} y={y} width={NW} height={NH} rx={14}
                  fill="#0b1220" stroke={col} strokeWidth={1.6}
                  style={{ filter: `drop-shadow(0 0 8px ${col}44)` }} />
                <circle cx={x + 16} cy={n.y} r={4.5} fill={col} style={{ filter: `drop-shadow(0 0 5px ${col})` }} />
                <text x={x + 30} y={n.y - 4} fill="#fff" fontSize={15} fontWeight={700}>{n.label}</text>
                <text x={x + 30} y={n.y + 14} fill="#94a3b8" fontSize={11}>{n.sub}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-[11px] text-slate-600 text-center">
        Hover any box for details. Green = working live · Amber = simulated (mock) · Blue = ready to connect · Red = offline · Grey = not built.
      </p>
    </div>
  );
}
