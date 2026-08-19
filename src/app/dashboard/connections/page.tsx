"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, Loader2, User, Bot, Activity, Copy, Check, Crown, History } from "lucide-react";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector { key: string; mode: Mode }

const COLOR: Record<Mode, string> = { live: "#34d399", configured: "#38bdf8", simulated: "#fbbf24", offline: "#f43f5e", notbuilt: "#64748b" };
const MODE_LABEL: Record<Mode, string> = { live: "Live", configured: "Ready to connect", simulated: "Simulated (mock)", offline: "Offline", notbuilt: "Not built" };

const PHASES = ["Onboard & Brain", "Plan & Approve", "Produce", "Publish", "Advertise", "Report & Learn"];
const COL_X = [150, 430, 710, 990, 1270, 1500];

interface Stage {
  n: number; col: number; label: string; sub: string;
  deps: string[]; manual?: boolean; tech: string[]; brief: string;
}
const STAGES: Stage[] = [
  { n: 1, col: 0, label: "Client Onboarding", sub: "Onboarding Bot", deps: ["supabase_db"], manual: true, tech: ["Manual upload", "Supabase"], brief: "Founder enters brand details and uploads logo, guidelines & products — creates the client profile + an empty Brand Brain." },
  { n: 2, col: 0, label: "Brand Brain", sub: "Brand Memory Bot", deps: ["supabase_db", "openrouter"], tech: ["Claude", "Supabase"], brief: "Holds colours, fonts, tone, address & contact; AI writes the brand brief. Designers can also import knowledge docs (zip/pdf/txt)." },
  { n: 3, col: 1, label: "Strategy Planning", sub: "Planning Bot", deps: ["openrouter"], tech: ["Claude", "GPT-4o"], brief: "Drafts monthly strategy, pillars, calendar & budget. Supports one-shot GPT-4o generation and HTML/PDF plan import." },
  { n: 4, col: 1, label: "Internal Approval", sub: "Founder Review", deps: ["supabase_db"], manual: true, tech: ["Manual"], brief: "Founder reviews the plan — approve to send onward, or reject to auto-regenerate with notes." },
  { n: 5, col: 1, label: "Client Plan Approval", sub: "WhatsApp Bot", deps: ["whatsapp"], manual: true, tech: ["WhatsApp"], brief: "Sends the plan PDF + calendar to the client on WhatsApp and records approval or change requests." },
  { n: 6, col: 2, label: "Task Creation", sub: "AI Project Manager", deps: ["supabase_db"], tech: ["Supabase"], brief: "Turns the approved calendar into production tasks (copy/image/video) and assigns them with deadlines." },
  { n: 7, col: 2, label: "Creative Production", sub: "Script / Image / Video", deps: ["higgsfield", "openrouter"], tech: ["Higgsfield · Nano Banana", "GPT Image 2", "Gemini", "Drive"], brief: "Writes captions/scripts (Gemini), generates images (Higgsfield Nano Banana Pro/2 + GPT Image 2, up to 4K) and videos; saves to Google Drive." },
  { n: 8, col: 2, label: "Quality Check", sub: "QC Bot", deps: ["openrouter"], tech: ["Gemini"], brief: "AI audits grammar, brand-name spelling, claims and offer/address accuracy before a human sees it." },
  { n: 9, col: 2, label: "Founder Approval", sub: "Approval Bot", deps: ["supabase_db"], manual: true, tech: ["Manual"], brief: "Founder reviews each creative in a swipe deck — approve, or reject with revision notes." },
  { n: 10, col: 2, label: "Client Creative OK", sub: "WhatsApp Bot", deps: ["whatsapp"], manual: true, tech: ["WhatsApp"], brief: "Sends the approved creative to the client on WhatsApp for final sign-off." },
  { n: 20, col: 3, label: "Designer Uploads", sub: "Content Hub", deps: ["google_drive"], manual: true, tech: ["Manual upload", "Drive", "Brand QC"], brief: "Designers upload Posts/Reels/Stories per client (multi-file, numbered); saved to Google Drive and auto brand-QC'd (images + video frames) before reaching the social team." },
  { n: 21, col: 3, label: "Social Publisher", sub: "Publishing Desk", deps: ["recurpost"], tech: ["RecurPost", "GPT-4o / Gemini"], brief: "Social team picks a Content Hub item, AI writes the caption from the Brand Brain, sets thumbnail + schedule, and posts to IG/FB/Pinterest/LinkedIn/YouTube via RecurPost." },
  { n: 11, col: 3, label: "Ad Publishing", sub: "Creative Publisher", deps: ["meta"], tech: ["Meta Graph"], brief: "The approved-creative pipeline: schedules approved creatives and posts them to Instagram/Facebook directly via Meta; a cron publishes due posts every 15 minutes." },
  { n: 15, col: 3, label: "WhatsApp Task Bar", sub: "Group Reader", deps: ["wa_reader"], tech: ["Baileys reader", "Gemini"], brief: "A dedicated WhatsApp number reads client group messages (read-only); AI triages each into client, summary, is-it-a-task and urgency for staff to assign." },
  { n: 12, col: 4, label: "Budget Planning", sub: "Media Planning Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Drafts the Meta/Google budget split, objectives, audiences and daily budgets." },
  { n: 13, col: 4, label: "Campaign Setup", sub: "Meta / Google Ads", deps: ["meta"], tech: ["Meta Graph"], brief: "Builds PAUSED Meta campaigns, ad sets and ads from QC-passed creatives (activation needs founder approval)." },
  { n: 14, col: 4, label: "Ads Monitoring", sub: "Optimisation Bot", deps: ["ad_metrics"], tech: ["Simulated metrics"], brief: "Daily autopilot scales/trims/pauses by ROAS rules. NOTE: metrics are simulated — real Meta Insights not built yet." },
  { n: 16, col: 5, label: "Reporting", sub: "Analytics Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Generates weekly client performance reports and daily founder briefings." },
  { n: 17, col: 5, label: "Continuous Learning", sub: "Learning Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Weekly loop re-tunes each client's Brand Brain and the shared Agency Brain from results & feedback." },
];
const EDGES: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
  [10, 11], [20, 11], [11, 15], [11, 12], [12, 13], [13, 14], [14, 16], [16, 17], [17, 2],
];

const NW = 200, NH = 66, CY = 500, GAP = 112, LOOP_Y = 920;

/**
 * The management layer: duty-cycles over the same data, one face (Bron).
 * Each manager is the SMART model wearing a job description — no separate
 * subscriptions, no separate chat personas. Status tracks what is real today.
 */
interface Manager { name: string; model: string; status: "active" | "planned"; face: string; skills: string[] }
const MANAGERS: Manager[] = [
  {
    name: "Ochrester — Main Manager", model: "Claude Sonnet", status: "active", face: "Speaks through Bron",
    skills: [
      "Reads all four managers' daily notes",
      "Produces one exception brief — “3 things need you today”",
      "Never talks to you directly; Bron carries what it finds",
      "Ask Bron: \u201cwhat did the managers find today?\u201d",
    ],
  },
  {
    name: "Brand Manager", model: "Claude Sonnet + Gemini vision", status: "active", face: "Brand memory keeper",
    skills: [
      "Reads Brand Brain, briefs and the feedback log",
      "Flags missing address/phone/colours that block captions",
      "Watches QC rejections for repeat brand mismatches",
      "Curates the Style Library — flags thin categories",
      "Watches WhatsApp group activity for silent/unhappy clients",
    ],
  },
  {
    name: "Design Manager", model: "Claude Sonnet + GPT Image + Gemini critic", status: "active", face: "Art director on 5b",
    skills: [
      "Owns Plan → Posts: productionNote → scene prompt → render → critic",
      "Merges Style Library exemplars into every generated frame",
      "Enforces the plan's art direction over generic AI output",
      "Critic pass catches clipped text and cropped product before a human",
    ],
  },
  {
    name: "Content Writing Manager", model: "GPT-4o + Gemini vision", status: "active", face: "Copywriter",
    skills: [
      "Reads the whole creative first — prices on it appear verbatim",
      "Captions run 100–120 words with address + phone mandatory",
      "Catalogue Ad Copy: primary text + 2–3 word headlines",
      "Flags captions stuck in failed / no-contact",
    ],
  },
  {
    name: "Social Media Manager", model: "Mostly plain code + RecurPost", status: "active", face: "Scheduler",
    skills: [
      "Automation tab: batch QC verdicts, ripple dates, gaps, story slots",
      "Festival stories: right creative, right day, right time — automatic",
      "RecurPost health: sent, failed, queued",
      "Flags failed posts and clients with an empty week",
    ],
  },
];

/** What shipped, newest first — the console doubles as the portal's changelog. */
const UPDATES: { date: string; text: string }[] = [
  { date: "19 Aug", text: "Management layer Phase 1 is live: every morning at 7:45 the four managers walk their territory (missing contacts, thin style categories, failed captions and posts, bare festivals, empty weeks, unanswered groups) and Ochrester compresses it into one brief — ask Bron \u201cwhat did the managers find today?\u201d" },
  { date: "19 Aug", text: "Style Library replaces the unused Ad Production kanban: four jewellery categories (Traditional / Modern / Surreal / Boutique), bulk JPG/PNG/PDF upload to Drive (500MB per drop), automatic style-JSON extraction with one locked ~23-field schema incl. typography, staff curation with starring, per-category font mapping, per-client default style — and a Style selector on 5b that merges the best-matching exemplars into every generated frame." },
  { date: "18 Aug", text: "WhatsApp bridge phase 2: client media auto-downloads to Drive and shows on tasks, DMs get a rename directory (unknown numbers wait in a tray), and outbound messages go through a human-gated queue paced like a person." },
  { date: "18 Aug", text: "Bron speaks with a real voice (OpenAI TTS), hears voice notes, and covers festivals, automation status, Drive health and per-client WhatsApp activity truthfully from the database." },
  { date: "18 Aug", text: "5b shows the exact image prompt (and model) before Build — nobody pays to find out what was sent." },
  { date: "17 Aug", text: "Automation tab: approved creatives arrive dated and captioned automatically — everyday/alternate/manual with ripple re-flow, same-day spacing, configurable gaps, drag-to-reorder, and a caption backfill for stuck rows." },
  { date: "17 Aug", text: "Captions are QC-grounded: the whole video/creative is read first, on-creative prices appear verbatim, 100–120 words, address + phone mandatory." },
  { date: "17 Aug", text: "Festival stories schedule themselves once QC passes — Library only, at the festival's own day and time; a Festivals page lets staff add/retime/delete." },
  { date: "17 Aug", text: "One rejected creative rejects its whole upload batch for that client — no half-approved batches slip through." },
  { date: "17 Aug", text: "Permission system now covers every staff page (two had no section registered), with a regression test so it stays that way." },
  { date: "16 Aug", text: "Plan imports keep the author's calendar: 'Keep my slots' is the primary action, missing details (brand colours, placeholders) are asked for instead of guessed, and generated posts follow the plan's own art direction." },
  { date: "16 Aug", text: "Generation reliability: timeouts on every external call, Drive photos read through the API instead of hanging on its CDN, step-by-step logs, and text that always fits the frame." },
];

export default function AgentsConsolePage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (res.ok) setConnectors((await res.json()).connectors || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep test — actively probes each service (LLM ping, storage write, Higgsfield
  // cost preflight) and produces a copy-paste support report.
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepReport, setDeepReport] = useState<string | null>(null);
  const [deepSummary, setDeepSummary] = useState<{ ok: number; warn: number; fail: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const runDeep = async () => {
    setDeepLoading(true);
    setCopied(false);
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) { setDeepReport(data.report || ""); setDeepSummary(data.summary || null); }
      else setDeepReport(data.error || "Deep test failed.");
    } catch (e: unknown) {
      setDeepReport(e instanceof Error ? e.message : "Deep test failed.");
    } finally {
      setDeepLoading(false);
    }
  };
  const copyReport = async () => {
    if (!deepReport) return;
    try { await navigator.clipboard.writeText(deepReport); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* ignore */ }
  };

  const modeOf = (key: string): Mode => (connectors.find((c) => c.key === key)?.mode as Mode) || "notbuilt";
  const stageMode = (s: Stage): Mode => {
    const m = s.deps.map(modeOf);
    if (m.includes("offline")) return "offline";
    if (m.includes("notbuilt")) return "notbuilt";
    if (m.includes("simulated")) return "simulated";
    if (m.includes("configured")) return "configured";
    return "live";
  };

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
    if (a === 17 && b === 2) return `M ${s.x} ${s.y + NH / 2} C ${s.x} ${LOOP_Y}, ${t.x} ${LOOP_Y}, ${t.x} ${t.y + NH / 2}`;
    if (t.s.col > s.s.col) { const sx = s.x + NW / 2, tx = t.x - NW / 2; return `M ${sx} ${s.y} C ${sx + 60} ${s.y}, ${tx - 60} ${t.y}, ${tx} ${t.y}`; }
    const down = t.y > s.y; const sy = down ? s.y + NH / 2 : s.y - NH / 2; const ty = down ? t.y - NH / 2 : t.y + NH / 2;
    return `M ${s.x} ${sy} C ${s.x} ${(sy + ty) / 2}, ${t.x} ${(sy + ty) / 2}, ${t.x} ${ty}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-indigo-400" /><span>Agents Console</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Every agent in the workflow, the exact model it runs on, and where a human uploads. Neon flows show it working live.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runDeep} disabled={deepLoading} title="Actively test every service and get a copy-paste report" className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
            {deepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}<span>Deep Test</span>
          </button>
          <button onClick={load} disabled={loading} className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}<span>Refresh</span>
          </button>
        </div>
      </div>

      {deepReport && (
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center space-x-2 text-sm font-bold">
              {deepSummary && <>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400 text-xs">{deepSummary.ok} OK</span>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-900 text-amber-400 text-xs">{deepSummary.warn} Warn</span>
                <span className="px-2.5 py-0.5 rounded-full bg-rose-950/40 border border-rose-900 text-rose-400 text-xs">{deepSummary.fail} Fail</span>
              </>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={copyReport} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}<span>{copied ? "Copied!" : "Copy Report"}</span>
              </button>
              <button onClick={() => setDeepReport(null)} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 text-xs font-bold cursor-pointer">Close</button>
            </div>
          </div>
          <pre className="bg-black/50 border border-slate-900 rounded-xl p-3 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-words font-mono max-h-80 overflow-y-auto">{deepReport}</pre>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
        {(Object.keys(COLOR) as Mode[]).map((m) => (
          <span key={m} className="flex items-center space-x-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR[m], boxShadow: `0 0 6px ${COLOR[m]}` }} /><span>{MODE_LABEL[m]}</span>
          </span>
        ))}
        <span className="flex items-center space-x-1.5 text-slate-400"><User className="w-3 h-3" /><span>Manual (human) step — dashed</span></span>
      </div>

      {/* Flow diagram */}
      <div className="bg-slate-950/50 border border-slate-900 rounded-3xl p-4 overflow-x-auto">
        <svg viewBox="0 0 1640 980" className="w-full" style={{ minWidth: 1200 }}>
          <style>{`.ac-flow{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:8 20;animation:ac-dash 1s linear infinite}@keyframes ac-dash{to{stroke-dashoffset:-28}}`}</style>
          {PHASES.map((p, i) => (<text key={p} x={COL_X[i]} y={44} textAnchor="middle" fill="#64748b" fontSize={13} fontWeight={800} letterSpacing="1">{p.toUpperCase()}</text>))}
          {EDGES.map(([a, b], i) => {
            const loop = a === 17 && b === 2; const col = COLOR[stageMode(pos[a].s)]; const d = edgePath(a, b);
            return (<g key={i}>
              <path d={d} fill="none" stroke={loop ? "#818cf8" : col} strokeWidth={2.4} opacity={loop ? 0.18 : 0.12} strokeDasharray={loop ? "6 8" : undefined} />
              <path d={d} className="ac-flow" stroke={loop ? "#818cf8" : col} style={{ filter: `drop-shadow(0 0 4px ${loop ? "#818cf8" : col})` }} />
            </g>);
          })}
          <text x={(COL_X[0] + COL_X[5]) / 2} y={LOOP_Y - 8} textAnchor="middle" fill="#818cf8" fontSize={12} fontWeight={700}>↺ Results & feedback return to the Brand Brain</text>
          {STAGES.map((s) => {
            const p = pos[s.n]; const mode = stageMode(s); const col = COLOR[mode];
            const x = p.x - NW / 2, y = p.y - NH / 2;
            return (<g key={s.n}>
              <title>{`${s.n}. ${s.label} (${s.manual ? "Manual" : "Agent"}) — ${MODE_LABEL[mode]}\n${s.tech.join(" · ")}\n${s.brief}`}</title>
              <rect x={x} y={y} width={NW} height={NH} rx={13} fill="#0b1220" stroke={col} strokeWidth={1.6} strokeDasharray={s.manual ? "5 4" : undefined} style={{ filter: `drop-shadow(0 0 8px ${col}40)` }} />
              <circle cx={x + 22} cy={p.y} r={14} fill="#0f172a" stroke={col} strokeWidth={1.4} />
              <text x={x + 22} y={p.y + 4} textAnchor="middle" fill={col} fontSize={12} fontWeight={800}>{s.n}</text>
              <text x={x + 46} y={p.y - 10} fill="#fff" fontSize={13} fontWeight={700}>{s.label}</text>
              <text x={x + 46} y={p.y + 5} fill="#94a3b8" fontSize={10}>{s.manual ? "👤 " : "🤖 "}{s.sub}</text>
              <text x={x + 46} y={p.y + 19} fill={col} fontSize={9.5} fontWeight={600}>{s.tech.slice(0, 2).join(" · ")}</text>
            </g>);
          })}
        </svg>
      </div>

      {/* Agent briefings */}
      <div>
        <h2 className="text-sm font-bold text-white mb-3">Agent Briefings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {STAGES.map((s) => {
            const mode = stageMode(s); const col = COLOR[mode];
            return (
              <div key={s.n} className="bg-slate-950/60 border border-slate-900 rounded-2xl p-3.5" style={{ borderLeft: `3px solid ${col}` }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center space-x-2 min-w-0">
                    <span className="text-[10px] font-black w-5 h-5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0" style={{ color: col }}>{s.n}</span>
                    <h3 className="text-xs font-bold text-white truncate">{s.label}</h3>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-slate-800 text-slate-400 flex items-center space-x-1 shrink-0">
                      {s.manual ? <User className="w-2.5 h-2.5" /> : <Bot className="w-2.5 h-2.5" />}<span>{s.manual ? "Manual" : "Agent"}</span>
                    </span>
                  </div>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full border shrink-0" style={{ color: col, borderColor: `${col}55`, background: `${col}18` }}>{MODE_LABEL[mode]}</span>
                </div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {s.tech.map((t) => (<span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">{t}</span>))}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{s.brief}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Management layer — Ochrester and the four managers */}
      <div>
        <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Crown className="w-4 h-4 text-[var(--yellow)]" /><span>Management Layer</span>
        </h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Duty-cycles over the same data, one face: you talk to Bron, Bron carries what the managers find. Each is the smart model wearing a job description — not a separate subscription.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MANAGERS.map((m) => (
            <div key={m.name} className={`bg-slate-950/60 border rounded-2xl p-4 ${m.status === "active" ? "border-emerald-900/60" : "border-slate-900"}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-xs font-bold text-white">{m.name}</h3>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border shrink-0 ${m.status === "active" ? "text-emerald-400 border-emerald-900 bg-emerald-950/40" : "text-slate-400 border-slate-800 bg-slate-900"}`}>
                  {m.status === "active" ? "Live — reports daily 7:45 AM" : "Planned"}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">{m.face} · <span className="text-slate-400 font-semibold">{m.model}</span></p>
              <ul className="space-y-1">
                {m.skills.map((sk) => (
                  <li key={sk} className="text-[11px] text-slate-400 leading-snug flex items-start gap-1.5">
                    <span className="text-indigo-400 mt-0.5">▸</span><span>{sk}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Changelog — what shipped, newest first */}
      <div>
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" /><span>Recent Updates</span>
        </h2>
        <div className="bg-slate-950/50 border border-slate-900 rounded-2xl divide-y divide-slate-900/70">
          {UPDATES.map((u, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5">
              <span className="text-[10px] font-black text-slate-500 w-14 shrink-0 mt-0.5">{u.date}</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">{u.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
