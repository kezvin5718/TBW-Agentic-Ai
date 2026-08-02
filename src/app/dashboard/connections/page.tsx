"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, Loader2 } from "lucide-react";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector { key: string; mode: Mode }

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
  simulated: "Simulated (mock)",
  offline: "Offline",
  notbuilt: "Not built",
};

// Column phases of the agentic workflow.
const PHASES = ["Onboard & Brain", "Plan & Approve", "Produce", "Publish", "Advertise", "Report & Learn"];
const COL_X = [140, 400, 660, 920, 1180, 1420];

// The 19-step workflow. `col` = phase column, `deps` = which live connectors it relies on.
interface Stage { n: number; col: number; label: string; sub: string; deps: string[] }
const STAGES: Stage[] = [
  { n: 1, col: 0, label: "Client Onboarding", sub: "Onboarding Bot", deps: ["supabase_db"] },
  { n: 2, col: 0, label: "Brand Brain", sub: "Brand Memory Bot", deps: ["supabase_db", "openrouter"] },
  { n: 3, col: 1, label: "Strategy Planning", sub: "Planning Bot", deps: ["openrouter", "supabase_db"] },
  { n: 4, col: 1, label: "Internal Approval", sub: "Founder Review", deps: ["supabase_db"] },
  { n: 5, col: 1, label: "Client Plan Approval", sub: "WhatsApp Bot", deps: ["whatsapp"] },
  { n: 6, col: 2, label: "Task Creation", sub: "AI Project Manager", deps: ["supabase_db"] },
  { n: 7, col: 2, label: "Creative Production", sub: "Script / Image / Video", deps: ["higgsfield", "openrouter"] },
  { n: 8, col: 2, label: "Quality Check", sub: "QC Bot", deps: ["openrouter"] },
  { n: 9, col: 2, label: "Founder Approval", sub: "Approval Bot", deps: ["supabase_db"] },
  { n: 10, col: 2, label: "Client Creative OK", sub: "WhatsApp Bot", deps: ["whatsapp"] },
  { n: 11, col: 3, label: "Schedule & Publish", sub: "Publishing Bot", deps: ["meta"] },
  { n: 15, col: 3, label: "WhatsApp Automation", sub: "Agency Assistant", deps: ["whatsapp"] },
  { n: 12, col: 4, label: "Budget Planning", sub: "Media Planning Bot", deps: ["openrouter"] },
  { n: 13, col: 4, label: "Campaign Setup", sub: "Meta / Google Ads", deps: ["meta"] },
  { n: 14, col: 4, label: "Ads Monitoring", sub: "Optimisation Bot", deps: ["ad_metrics"] },
  { n: 16, col: 5, label: "Reporting", sub: "Analytics Bot", deps: ["openrouter", "supabase_db"] },
  { n: 17, col: 5, label: "Continuous Learning", sub: "Learning Bot", deps: ["openrouter"] },
];
// Sequential flow + the WhatsApp-group branch + the learning loop back to Brand Brain.
const EDGES: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
  [10, 11], [11, 15], [11, 12], [12, 13], [13, 14], [14, 16], [16, 17], [17, 2],
];

const NW = 184, NH = 56, CY = 500, GAP = 104, LOOP_Y = 900;

export default function AgentsConsolePage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (res.ok) setConnectors((await res.json()).connectors || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const modeOf = (key: string): Mode => (connectors.find((c) => c.key === key)?.mode as Mode) || "notbuilt";

  // Compute each stage's status from its dependencies (worst wins).
  const stageMode = (s: Stage): Mode => {
    const modes = s.deps.map(modeOf);
    if (modes.includes("offline")) return "offline";
    if (modes.includes("notbuilt")) return "notbuilt";
    if (modes.includes("simulated")) return "simulated";
    if (modes.includes("configured")) return "configured";
    return "live";
  };

  // Position each stage within its column, vertically centred.
  const byCol: Record<number, Stage[]> = {};
  STAGES.forEach((s) => { (byCol[s.col] ||= []).push(s); });
  const pos: Record<number, { x: number; y: number; s: Stage }> = {};
  Object.entries(byCol).forEach(([col, list]) => {
    const c = Number(col);
    const startY = CY - ((list.length - 1) * GAP) / 2;
    list.forEach((s, i) => { pos[s.n] = { x: COL_X[c], y: startY + i * GAP, s }; });
  });

  const edgePath = (a: number, b: number) => {
    const s = pos[a], t = pos[b];
    if (a === 17 && b === 2) {
      return `M ${s.x} ${s.y + NH / 2} C ${s.x} ${LOOP_Y}, ${t.x} ${LOOP_Y}, ${t.x} ${t.y + NH / 2}`;
    }
    if (t.s.col > s.s.col) {
      const sx = s.x + NW / 2, tx = t.x - NW / 2;
      return `M ${sx} ${s.y} C ${sx + 70} ${s.y}, ${tx - 70} ${t.y}, ${tx} ${t.y}`;
    }
    // same column (vertical)
    const down = t.y > s.y;
    const sy = down ? s.y + NH / 2 : s.y - NH / 2;
    const ty = down ? t.y - NH / 2 : t.y + NH / 2;
    return `M ${s.x} ${sy} C ${s.x} ${(sy + ty) / 2}, ${t.x} ${(sy + ty) / 2}, ${t.x} ${ty}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-indigo-400" />
            <span>Agents Console</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">The full agentic workflow — onboarding to continuous learning. Neon flows show it working live; colour tells the status.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
        {(Object.keys(COLOR) as Mode[]).map((m) => (
          <span key={m} className="flex items-center space-x-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR[m], boxShadow: `0 0 6px ${COLOR[m]}` }} />
            <span>{MODE_LABEL[m]}</span>
          </span>
        ))}
      </div>

      <div className="bg-slate-950/50 border border-slate-900 rounded-3xl p-4 overflow-x-auto">
        <svg viewBox="0 0 1560 960" className="w-full" style={{ minWidth: 1100 }}>
          <style>{`
            .ac-flow { fill:none; stroke-width:2.4; stroke-linecap:round; stroke-dasharray:8 20; animation: ac-dash 1s linear infinite; }
            @keyframes ac-dash { to { stroke-dashoffset:-28; } }
          `}</style>

          {/* Phase headers */}
          {PHASES.map((p, i) => (
            <text key={p} x={COL_X[i]} y={70} textAnchor="middle" fill="#64748b" fontSize={13} fontWeight={800} letterSpacing="1">{p.toUpperCase()}</text>
          ))}

          {/* Edges */}
          {EDGES.map(([a, b], i) => {
            const loop = a === 17 && b === 2;
            const col = COLOR[stageMode(pos[a].s)];
            const d = edgePath(a, b);
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={loop ? "#818cf8" : col} strokeWidth={2.4} opacity={loop ? 0.18 : 0.12} strokeDasharray={loop ? "6 8" : undefined} />
                <path d={d} className="ac-flow" stroke={loop ? "#818cf8" : col} style={{ filter: `drop-shadow(0 0 4px ${loop ? "#818cf8" : col})` }} />
              </g>
            );
          })}
          {/* learning-loop label */}
          <text x={(COL_X[0] + COL_X[5]) / 2} y={LOOP_Y - 8} textAnchor="middle" fill="#818cf8" fontSize={12} fontWeight={700}>↺ Results & feedback return to the Brand Brain</text>

          {/* Nodes */}
          {STAGES.map((s) => {
            const p = pos[s.n];
            const mode = stageMode(s);
            const col = COLOR[mode];
            const x = p.x - NW / 2, y = p.y - NH / 2;
            return (
              <g key={s.n}>
                <title>{`${s.n}. ${s.label} — ${MODE_LABEL[mode]}`}</title>
                <rect x={x} y={y} width={NW} height={NH} rx={13} fill="#0b1220" stroke={col} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 8px ${col}40)` }} />
                <circle cx={x + 20} cy={p.y} r={13} fill="#0f172a" stroke={col} strokeWidth={1.4} />
                <text x={x + 20} y={p.y + 4} textAnchor="middle" fill={col} fontSize={12} fontWeight={800}>{s.n}</text>
                <text x={x + 42} y={p.y - 4} fill="#fff" fontSize={13.5} fontWeight={700}>{s.label}</text>
                <text x={x + 42} y={p.y + 13} fill="#94a3b8" fontSize={10.5}>{s.sub}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-[11px] text-slate-600 text-center">Hover any step for its status · Green = working live · Amber = simulated (needs a real connection) · Grey = not built.</p>
    </div>
  );
}
