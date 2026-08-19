"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, Loader2, User, Bot, Activity, Copy, Check, Crown, History, ScanSearch, X } from "lucide-react";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector { key: string; mode: Mode }

const COLOR: Record<Mode, string> = { live: "#34d399", configured: "#38bdf8", simulated: "#fbbf24", offline: "#f43f5e", notbuilt: "#64748b" };
const MODE_LABEL: Record<Mode, string> = { live: "Live", configured: "Ready to connect", simulated: "Simulated (mock)", offline: "Offline", notbuilt: "Not built" };

const PHASES = ["Onboard & Brain", "Plan & Approve", "Produce", "Publish", "Advertise", "Report & Learn"];
const COL_X = [150, 430, 710, 990, 1270, 1500];

type ManagerKey = "brand" | "design" | "content" | "social";

interface Stage {
  n: number; col: number; label: string; sub: string;
  deps: string[]; manual?: boolean; tech: string[]; brief: string;
  /** Which manager watches this stage every morning. */
  mgr?: ManagerKey;
}
const STAGES: Stage[] = [
  { n: 1, col: 0, label: "Client Onboarding", sub: "Onboarding Bot", deps: ["supabase_db"], manual: true, tech: ["Manual upload", "Supabase"], brief: "Founder enters brand details and uploads logo, guidelines & products — creates the client profile + an empty Brand Brain." },
  { n: 2, col: 0, label: "Brand Brain", sub: "Brand Memory Bot", deps: ["supabase_db", "openrouter"], tech: ["Claude", "Supabase"], mgr: "brand", brief: "Holds colours, fonts, tone, address & contact; AI writes the brand brief. Designers can also import knowledge docs (zip/pdf/txt). Missing address/phone here is what blocks captions." },
  { n: 3, col: 1, label: "Strategy Planning", sub: "Planning Bot", deps: ["openrouter"], tech: ["Claude", "GPT-4o"], brief: "Drafts monthly strategy, pillars, calendar & budget. Supports one-shot GPT-4o generation and HTML/PDF plan import that keeps the author's own calendar." },
  { n: 4, col: 1, label: "Internal Approval", sub: "Founder Review", deps: ["supabase_db"], manual: true, tech: ["Manual"], brief: "Founder reviews the plan — approve to send onward, or reject to auto-regenerate with notes." },
  { n: 5, col: 1, label: "Client Plan Approval", sub: "WhatsApp Bot", deps: ["whatsapp"], manual: true, tech: ["WhatsApp"], brief: "Sends the plan PDF + calendar to the client on WhatsApp and records approval or change requests." },
  { n: 6, col: 2, label: "Task Creation", sub: "AI Project Manager", deps: ["supabase_db"], tech: ["Supabase"], brief: "Turns the approved calendar into production tasks (copy/image/video) and assigns them with deadlines." },
  { n: 22, col: 2, label: "Style Library", sub: "Proven-look Extractor", deps: ["openrouter", "google_drive"], tech: ["Gemini vision", "Drive"], mgr: "brand", brief: "Old winning designs auto-extracted into style JSONs on four shelves — Traditional, Modern, Surreal, Boutique — with auto-sort and human override. 5b pulls the best-matching looks into every generated frame." },
  { n: 7, col: 2, label: "Creative Production", sub: "Script / Image / Video", deps: ["higgsfield", "openrouter"], tech: ["Higgsfield · Nano Banana", "GPT Image 2", "Style Library", "Drive"], mgr: "design", brief: "Writes captions/scripts, generates images and videos in the plan's own art direction, styled by the Style Library's proven looks; saves to Google Drive." },
  { n: 8, col: 2, label: "Quality Check", sub: "QC Bot", deps: ["openrouter"], tech: ["Gemini"], mgr: "design", brief: "AI audits grammar, brand-name spelling, claims and offer/address accuracy before a human sees it. One rejected creative rejects its whole upload batch." },
  { n: 9, col: 2, label: "Founder Approval", sub: "Approval Bot", deps: ["supabase_db"], manual: true, tech: ["Manual"], brief: "Founder reviews each creative in a swipe deck — approve, or reject with revision notes." },
  { n: 10, col: 2, label: "Client Creative OK", sub: "WhatsApp Bot", deps: ["whatsapp"], manual: true, tech: ["WhatsApp"], brief: "Sends the approved creative to the client on WhatsApp for final sign-off." },
  { n: 20, col: 3, label: "Designer Uploads", sub: "Content Hub", deps: ["google_drive"], manual: true, tech: ["Manual upload", "Drive", "Brand QC"], mgr: "content", brief: "Designers upload Posts/Reels/Stories per client; saved to Google Drive and auto brand-QC'd (images + video frames) before reaching the social team. Festival creatives schedule themselves." },
  { n: 21, col: 3, label: "Social Publisher", sub: "Publishing Desk", deps: ["recurpost"], tech: ["RecurPost", "GPT-4o / Gemini"], mgr: "social", brief: "Automation tab dates and captions approved work by itself (100–120 words, address + phone mandatory); posts to IG/FB/Pinterest/LinkedIn/YouTube via RecurPost." },
  { n: 11, col: 3, label: "Ad Publishing", sub: "Creative Publisher", deps: ["meta"], tech: ["Meta Graph"], mgr: "social", brief: "The approved-creative pipeline: schedules approved creatives and posts them to Instagram/Facebook directly via Meta; a cron publishes due posts every 15 minutes." },
  { n: 15, col: 3, label: "WhatsApp Bridge", sub: "Group Reader + Sender", deps: ["wa_reader"], tech: ["Baileys reader", "Gemini", "Drive"], mgr: "brand", brief: "A dedicated number reads client groups and DMs, downloads their media to Drive, frames tasks, and sends staff-queued updates one at a time at a human pace." },
  { n: 12, col: 4, label: "Budget Planning", sub: "Media Planning Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Drafts the Meta/Google budget split, objectives, audiences and daily budgets." },
  { n: 13, col: 4, label: "Campaign Setup", sub: "Meta / Google Ads", deps: ["meta"], tech: ["Meta Graph"], brief: "Builds PAUSED Meta campaigns, ad sets and ads from QC-passed creatives (activation needs founder approval)." },
  { n: 14, col: 4, label: "Ads Monitoring", sub: "Optimisation Bot", deps: ["ad_metrics"], tech: ["Simulated metrics"], brief: "Daily autopilot scales/trims/pauses by ROAS rules. NOTE: metrics are simulated — real Meta Insights not built yet." },
  { n: 16, col: 5, label: "Reporting", sub: "Analytics Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Generates weekly client performance reports and daily founder briefings from real posting numbers." },
  { n: 17, col: 5, label: "Continuous Learning", sub: "Learning Bot", deps: ["openrouter"], tech: ["Claude"], brief: "Weekly loop re-tunes each client's Brand Brain and the shared Agency Brain from results & feedback." },
];
const EDGES: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [22, 7], [7, 8], [8, 9], [9, 10],
  [10, 11], [20, 11], [11, 15], [11, 12], [12, 13], [13, 14], [14, 16], [16, 17], [17, 2],
];

const NW = 200, NH = 66, CY = 660, GAP = 112, LOOP_Y = 1100;

/** The management rail across the top of the diagram. */
const RAIL: { key: ManagerKey; name: string; model: string; x: number }[] = [
  { key: "brand", name: "Brand Manager", model: "Claude + Gemini vision", x: 250 },
  { key: "design", name: "Design Manager", model: "Claude + GPT Image", x: 545 },
  { key: "content", name: "Content Manager", model: "GPT-4o + Gemini", x: 840 },
  { key: "social", name: "Social Manager", model: "Code + RecurPost", x: 1135 },
];
const OCH = { x: 1460, y: 96 };

interface Manager { key: string; name: string; model: string; face: string; skills: string[] }
const MANAGERS: Manager[] = [
  {
    key: "ochrester", name: "Ochrester — Main Manager", model: "Claude Sonnet", face: "Speaks through Bron",
    skills: [
      "Reads all four managers' daily notes",
      "Produces one exception brief — “3 things need you today”",
      "Never talks to you directly; Bron carries what it finds",
      "Ask Bron: “what did the managers find today?”",
    ],
  },
  {
    key: "brand", name: "Brand Manager", model: "Claude Sonnet + Gemini vision", face: "Brand memory keeper",
    skills: [
      "Reads Brand Brain, briefs and the feedback log",
      "Flags missing address/phone/colours that block captions",
      "Watches QC rejections for repeat brand mismatches",
      "Curates the Style Library — flags thin categories",
      "Watches WhatsApp group activity for silent/unhappy clients",
    ],
  },
  {
    key: "design", name: "Design Manager", model: "Claude Sonnet + GPT Image + Gemini critic", face: "Art director on 5b",
    skills: [
      "Owns Plan → Posts: productionNote → scene prompt → render → critic",
      "Merges Style Library exemplars into every generated frame",
      "Enforces the plan's art direction over generic AI output",
      "Critic pass catches clipped text and cropped product before a human",
    ],
  },
  {
    key: "content", name: "Content Writing Manager", model: "GPT-4o + Gemini vision", face: "Copywriter",
    skills: [
      "Reads the whole creative first — prices on it appear verbatim",
      "Captions run 100–120 words with address + phone mandatory",
      "Catalogue Ad Copy: primary text + 2–3 word headlines",
      "Flags captions stuck in failed / no-contact",
    ],
  },
  {
    key: "social", name: "Social Media Manager", model: "Mostly plain code + RecurPost", face: "Scheduler",
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
  { date: "19 Aug", text: "Deliverables follow the plan, not the onboarding number: saving a plan counts its own calendar (posts/carousels/stories/reels) as that month's promise, a banner flags any gap against the contract with a one-click founder update, and the Brand Manager watches plan-vs-contract every morning — no more phantom placeholder posts padding to the old number." },
  { date: "19 Aug", text: "Style Library reads Instagram-style grids: switch the upload to Grid mode (auto-detect or 3×3/2×2/3×4/3×2) and one composite is sliced into individual tiles — each tile becomes its own design with the hairline gaps trimmed away, and tiles from one grid share a campaign marker." },
  { date: "19 Aug", text: "Agents Console rebuilt: the management rail now sits on the map itself with live issue counts from the morning scan, the Style Library is wired into Creative Production, and clicking any node explains what it is, what runs it, and what's wrong today." },
  { date: "19 Aug", text: "Style Library auto-sort: drop a mixed pile of old designs and the extractor files each on the right shelf (Traditional/Modern/Surreal/Boutique) — auto-filed cards wear an ✨ badge, every card has a move dropdown, and when the model disagrees with a human's shelf it shows a quiet “model thinks” hint." },
  { date: "19 Aug", text: "Management layer Phase 1 is live: every morning at 7:45 the four managers walk their territory (missing contacts, thin style categories, failed captions and posts, bare festivals, empty weeks, unanswered groups) and Ochrester compresses it into one brief — ask Bron “what did the managers find today?”" },
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

interface BriefRow { brief_date: string; brief: string | null; notes: Partial<Record<ManagerKey, string[]>>; created_at: string }
type Selected = { kind: "stage"; stage: Stage } | { kind: "manager"; mkey: string } | null;

export default function AgentsConsolePage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefRow, setBriefRow] = useState<BriefRow | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, bRes] = await Promise.all([
        fetch("/api/connections", { cache: "no-store" }),
        fetch("/api/manager-brief", { cache: "no-store" }),
      ]);
      if (cRes.ok) setConnectors((await cRes.json()).connectors || []);
      if (bRes.ok) setBriefRow((await bRes.json()).latest || null);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/manager-brief", { method: "POST" });
      if (res.ok) setBriefRow((await res.json()).latest || null);
    } finally { setScanning(false); }
  };

  // Deep test — actively probes each service and produces a copy-paste report.
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

  const issuesOf = (key: ManagerKey): string[] => (briefRow?.notes?.[key] as string[] | undefined) || [];
  const totalIssues = (["brand", "design", "content", "social"] as ManagerKey[]).reduce((n, k) => n + issuesOf(k).length, 0);

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

  const isSelStage = (n: number) => selected?.kind === "stage" && selected.stage.n === n;
  const isSelMgr = (k: string) => selected?.kind === "manager" && selected.mkey === k;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Share2 className="w-6 h-6 text-indigo-400" /><span>Agents Console</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            The whole system on one map — managers on top, workflow below. Click anything to see what it is, what runs it, and what&apos;s wrong today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runScan} disabled={scanning} title="Make the four managers walk their territory right now" className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}<span>Scan now</span>
          </button>
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
        {(Object.keys(COLOR) as Mode[]).map((m) => (
          <span key={m} className="flex items-center space-x-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR[m], boxShadow: `0 0 8px ${COLOR[m]}` }} /><span>{MODE_LABEL[m]}</span>
          </span>
        ))}
        <span className="flex items-center space-x-1.5 text-slate-400"><User className="w-3 h-3" /><span>Manual (human) step — dashed</span></span>
        <span className="flex items-center space-x-1.5 text-rose-400 font-bold">
          <span className="w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] flex items-center justify-center font-black">{totalIssues}</span>
          <span>issue{totalIssues === 1 ? "" : "s"} found {briefRow ? `on ${briefRow.brief_date}` : ""}</span>
        </span>
      </div>

      {/* Map + inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_330px] gap-4 items-start">
        <div className="bg-gradient-to-b from-slate-950/80 to-slate-950/40 border border-slate-900 rounded-3xl p-4 overflow-x-auto relative" style={{ backgroundImage: "radial-gradient(circle at 20% 0%, rgba(99,102,241,0.07), transparent 45%), radial-gradient(circle at 80% 100%, rgba(168,85,247,0.06), transparent 45%)" }}>
          <svg viewBox="0 0 1640 1150" className="w-full" style={{ minWidth: 1250 }}>
            <defs>
              <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#101a30" /><stop offset="100%" stopColor="#0a111f" />
              </linearGradient>
              <linearGradient id="mgrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1b1436" /><stop offset="100%" stopColor="#100b22" />
              </linearGradient>
              <linearGradient id="railEdge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.7" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <style>{`.ac-flow{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-dasharray:8 20;animation:ac-dash 1s linear infinite}@keyframes ac-dash{to{stroke-dashoffset:-28}}.ac-node{cursor:pointer}.ac-node:hover rect{filter:brightness(1.35)}`}</style>

            {/* ── Management rail ─────────────────────────────────────── */}
            <text x={30} y={44} fill="#a78bfa" fontSize={13} fontWeight={800} letterSpacing="2">MANAGEMENT LAYER</text>
            <text x={225} y={44} fill="#64748b" fontSize={11}>— walks the map below every morning at 7:45 and whenever you press Scan</text>

            {RAIL.map((m) => {
              const issues = issuesOf(m.key);
              const sel = isSelMgr(m.key);
              return (
                <g key={m.key} className="ac-node" onClick={() => setSelected({ kind: "manager", mkey: m.key })}>
                  <title>{`${m.name} — ${issues.length} issue(s) today. Click for details.`}</title>
                  <rect x={m.x - 100} y={70} width={200} height={52} rx={12} fill="url(#mgrGrad)" stroke={sel ? "#c084fc" : "#7c3aed"} strokeWidth={sel ? 2.5 : 1.4} style={{ filter: `drop-shadow(0 0 ${sel ? 14 : 8}px rgba(139,92,246,0.45))` }} />
                  <text x={m.x - 86} y={92} fill="#fff" fontSize={12.5} fontWeight={700}>{m.name}</text>
                  <text x={m.x - 86} y={108} fill="#a78bfa" fontSize={9.5} fontWeight={600}>{m.model}</text>
                  {issues.length > 0 ? (
                    <g>
                      <circle cx={m.x + 86} cy={72} r={11} fill="#e11d48" style={{ filter: "drop-shadow(0 0 6px #e11d48)" }} />
                      <text x={m.x + 86} y={76} textAnchor="middle" fill="#fff" fontSize={10.5} fontWeight={900}>{issues.length}</text>
                    </g>
                  ) : (
                    <circle cx={m.x + 86} cy={72} r={5} fill="#34d399" style={{ filter: "drop-shadow(0 0 5px #34d399)" }}>
                      <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              );
            })}

            {/* manager → Ochrester */}
            {RAIL.map((m) => (
              <g key={`e-${m.key}`}>
                <path d={`M ${m.x + 100} 96 C ${m.x + 170} 52, ${OCH.x - 190} 52, ${OCH.x - 112} 90`} fill="none" stroke="url(#railEdge)" strokeWidth={1.6} opacity={0.25} />
                <path d={`M ${m.x + 100} 96 C ${m.x + 170} 52, ${OCH.x - 190} 52, ${OCH.x - 112} 90`} className="ac-flow" stroke="url(#railEdge)" style={{ strokeWidth: 1.8 }} />
              </g>
            ))}

            {/* Ochrester + Bron */}
            <g className="ac-node" onClick={() => setSelected({ kind: "manager", mkey: "ochrester" })}>
              <title>Ochrester — compresses the four managers&apos; notes into one brief. Click for details.</title>
              <rect x={OCH.x - 110} y={68} width={220} height={56} rx={13} fill="url(#mgrGrad)" stroke={isSelMgr("ochrester") ? "#c084fc" : "#a855f7"} strokeWidth={isSelMgr("ochrester") ? 2.5 : 1.8} style={{ filter: "drop-shadow(0 0 14px rgba(168,85,247,0.5))" }} />
              <text x={OCH.x - 94} y={91} fill="#fff" fontSize={13.5} fontWeight={800}>👑 Ochrester</text>
              <text x={OCH.x - 94} y={108} fill="#a78bfa" fontSize={9.5} fontWeight={600}>Main Manager · one brief out</text>
            </g>
            <path d={`M ${OCH.x} 124 L ${OCH.x} 152`} className="ac-flow" stroke="#a855f7" style={{ strokeWidth: 2 }} />
            <g>
              <rect x={OCH.x - 110} y={154} width={220} height={40} rx={11} fill="#0b1220" stroke="#6366f1" strokeWidth={1.4} style={{ filter: "drop-shadow(0 0 8px rgba(99,102,241,0.4))" }} />
              <text x={OCH.x} y={171} textAnchor="middle" fill="#e0e7ff" fontSize={10.5} fontWeight={700}>🤖 Bron — “what did the managers find?”</text>
              <text x={OCH.x} y={186} textAnchor="middle" fill="#64748b" fontSize={9}>daily 7:45 IST · voice or text</text>
            </g>

            <line x1={30} y1={240} x2={1610} y2={240} stroke="#1e293b" strokeWidth={1} strokeDasharray="3 6" />

            {/* ── Workflow ────────────────────────────────────────────── */}
            {PHASES.map((p, i) => (<text key={p} x={COL_X[i]} y={310} textAnchor="middle" fill="#64748b" fontSize={13} fontWeight={800} letterSpacing="1">{p.toUpperCase()}</text>))}
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
              const sel = isSelStage(s.n);
              return (<g key={s.n} className="ac-node" onClick={() => setSelected({ kind: "stage", stage: s })}>
                <title>{`${s.n}. ${s.label} (${s.manual ? "Manual" : "Agent"}) — ${MODE_LABEL[mode]}. Click for details.`}</title>
                <rect x={x} y={y} width={NW} height={NH} rx={13} fill="url(#cardGrad)" stroke={sel ? "#fff" : col} strokeWidth={sel ? 2.4 : 1.6} strokeDasharray={s.manual ? "5 4" : undefined} style={{ filter: `drop-shadow(0 0 ${sel ? 14 : 8}px ${col}55)` }} />
                <circle cx={x + 22} cy={p.y} r={14} fill="#0f172a" stroke={col} strokeWidth={1.4} />
                <text x={x + 22} y={p.y + 4} textAnchor="middle" fill={col} fontSize={11} fontWeight={800}>{s.n}</text>
                <text x={x + 46} y={p.y - 10} fill="#fff" fontSize={13} fontWeight={700}>{s.label}</text>
                <text x={x + 46} y={p.y + 5} fill="#94a3b8" fontSize={10}>{s.manual ? "👤 " : "🤖 "}{s.sub}</text>
                <text x={x + 46} y={p.y + 19} fill={col} fontSize={9.5} fontWeight={600}>{s.tech.slice(0, 2).join(" · ")}</text>
                <circle cx={x + NW - 12} cy={y + 12} r={4} fill={col}>
                  <animate attributeName="opacity" values="1;0.25;1" dur="2s" repeatCount="indefinite" />
                </circle>
              </g>);
            })}
          </svg>
        </div>

        {/* Inspector */}
        <div className="bg-slate-950/70 border border-slate-900 rounded-3xl p-5 xl:sticky xl:top-4 space-y-3 min-h-[300px]">
          {selected === null ? (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><ScanSearch className="w-4 h-4 text-indigo-400" /><span>Today&apos;s brief</span></h3>
              {briefRow?.brief ? (
                <>
                  <p className="text-[10px] text-slate-500">Scanned {briefRow.brief_date} · press <span className="text-purple-400 font-bold">Scan now</span> for a fresh look</p>
                  <pre className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans bg-black/30 border border-slate-900 rounded-xl p-3 max-h-[420px] overflow-y-auto">{briefRow.brief}</pre>
                </>
              ) : (
                <p className="text-xs text-slate-500">No scan yet — press <span className="text-purple-400 font-bold">Scan now</span> and the four managers will walk the map and report here.</p>
              )}
              <p className="text-[10px] text-slate-600 border-t border-slate-900 pt-2">Click any node or manager on the map to inspect it.</p>
            </>
          ) : selected.kind === "manager" ? (() => {
            const m = MANAGERS.find((x) => x.key === selected.mkey);
            const issues = selected.mkey === "ochrester" ? [] : issuesOf(selected.mkey as ManagerKey);
            if (!m) return null;
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><Crown className="w-4 h-4 text-purple-400" /><span>{m.name}</span></h3>
                  <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-[10px] text-slate-500">{m.face} · <span className="text-slate-400 font-semibold">{m.model}</span> · <span className="text-emerald-400 font-bold">Live — daily 7:45</span></p>
                {selected.mkey === "ochrester" && briefRow?.brief && (
                  <pre className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans bg-black/30 border border-slate-900 rounded-xl p-3 max-h-64 overflow-y-auto">{briefRow.brief}</pre>
                )}
                {issues.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-rose-400 uppercase tracking-wider">Issues found {briefRow ? `(${briefRow.brief_date})` : ""}</p>
                    {issues.map((it, i) => (
                      <p key={i} className="text-[11px] text-rose-200/90 leading-snug bg-rose-950/20 border border-rose-900/40 rounded-lg px-2.5 py-1.5">{it}</p>
                    ))}
                  </div>
                )}
                {selected.mkey !== "ochrester" && issues.length === 0 && (
                  <p className="text-[11px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 rounded-lg px-2.5 py-1.5">All clear in this manager&apos;s territory{briefRow ? ` as of ${briefRow.brief_date}` : ""}.</p>
                )}
                <div className="space-y-1 border-t border-slate-900 pt-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Duties</p>
                  {m.skills.map((sk) => (
                    <p key={sk} className="text-[11px] text-slate-400 leading-snug flex items-start gap-1.5"><span className="text-indigo-400 mt-0.5">▸</span><span>{sk}</span></p>
                  ))}
                </div>
              </>
            );
          })() : (() => {
            const s = selected.stage; const mode = stageMode(s); const col = COLOR[mode];
            const watcher = s.mgr ? MANAGERS.find((m) => m.key === s.mgr) : null;
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-[10px] font-black w-5 h-5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center" style={{ color: col }}>{s.n}</span>
                    <span>{s.label}</span>
                  </h3>
                  <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full border" style={{ color: col, borderColor: `${col}55`, background: `${col}18` }}>{MODE_LABEL[mode]}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-slate-800 text-slate-400 flex items-center space-x-1">
                    {s.manual ? <User className="w-2.5 h-2.5" /> : <Bot className="w-2.5 h-2.5" />}<span>{s.manual ? "Manual step" : "Agent"}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.tech.map((t) => (<span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">{t}</span>))}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{s.brief}</p>
                {watcher && (
                  <button onClick={() => setSelected({ kind: "manager", mkey: watcher.key })} className="text-[10px] text-purple-400 hover:text-purple-300 cursor-pointer border-t border-slate-900 pt-2 w-full text-left">
                    👁 Watched daily by <span className="font-bold">{watcher.name}</span> — view its findings ▸
                  </button>
                )}
              </>
            );
          })()}
        </div>
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
