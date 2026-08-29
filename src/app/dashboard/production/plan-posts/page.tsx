"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles, Loader2, CheckCircle2, AlertTriangle, UploadCloud, Images,
  ArrowRight, Camera, Wand2, RefreshCw,
} from "lucide-react";

interface SpecRow {
  item: number; date: string | null; platform: string; contentType: string;
  kind: "product" | "generated"; frames: number; headline: string; reason: string;
  imagePrompt?: string | null;
}
interface PhotoRow { id: string; seq: number; image_url: string; file_name: string | null; description: string | null }
/** What the running build reports about itself. Counts, never a guess. */
interface BuildProgress {
  startedAt: string; updatedAt: string; totalFrames: number; doneFrames: number;
  step: string; finished: boolean; note: string;
}
/** A slow image model is two attempts and minutes of honest waiting, so silence
 *  is not proof of death — past this, say so without claiming the run is dead. */
const STALE_MS = 90_000;

export default function PlanPostsPage() {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<{ id: string; month: string; status: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [planId, setPlanId] = useState("");

  const [analysis, setAnalysis] = useState<{
    clientName: string; month: string; total: number; needPhoto: number;
    photosRequired: number; generated: number; skippedReels: number;
    specs: SpecRow[]; photos: PhotoRow[]; alreadyMade: { id: string }[]; imagesReady: boolean;
    imageModel?: string;
    styleCategory?: string | null;
    styleCounts?: Record<string, number>;
    looksGeneric?: boolean;
    driveConnected?: boolean;
    driveError?: string | null;
    driveQuota?: { usedGb: number; limitGb: number | null; percent: number | null } | null;
  } | null>(null);
  // null = follow the client's default from the Style Library; "" = no style.
  const [styleSel, setStyleSel] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  // A background refresh — content stays on screen, only the sync icon spins.
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<"" | "photos" | "generate">("");
  const [uploadPct, setUploadPct] = useState(0);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  // Its own second hand: elapsed and the stale warning have to keep counting
  // when the server has gone quiet, which is precisely when they matter.
  const [nowMs, setNowMs] = useState(Date.now());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Nothing is selected to begin with. While the templates are still being
  // judged, building the whole month by accident is the expensive mistake.
  const [picked, setPicked] = useState<number[]>([]);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("clients").select("id, name").is("archived_at", null).order("name");
      setClients(data || []);
    })();
  }, []);

  useEffect(() => {
    if (!clientId) { setPlans([]); setPlanId(""); return; }
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("monthly_plans").select("id, month, status")
        .eq("client_id", clientId).order("month", { ascending: false });
      setPlans(data || []);
      setPlanId(data?.[0]?.id || "");
      setStyleSel(null); // a new client brings its own default style
    })();
  }, [clientId]);

  // Which plan the analysis on screen belongs to, and when it was fetched.
  // A refresh for the SAME plan updates in place — blanking the whole page
  // behind a spinner on every sync made the tool feel broken.
  const shownPlanRef = useRef("");
  const lastAnalysedRef = useRef(0);

  const analyse = useCallback(async () => {
    if (!planId) { setAnalysis(null); shownPlanRef.current = ""; return; }
    const changingPlan = shownPlanRef.current !== planId;
    if (changingPlan) { setLoading(true); setNotice(null); }
    setRefreshing(true);
    try {
      const styleQ = styleSel !== null ? `&style=${encodeURIComponent(styleSel)}` : "";
      const res = await fetch(`/api/production/plan-posts?planId=${planId}${styleQ}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the plan");
      setAnalysis(data);
      shownPlanRef.current = planId;
      lastAnalysedRef.current = Date.now();
      if (changingPlan) setPicked([]);
    } catch (err: unknown) {
      if (changingPlan) setAnalysis(null);
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setLoading(false); setRefreshing(false); }
  }, [planId, styleSel]);

  useEffect(() => { analyse(); }, [analyse]);

  // While a build is in flight, ask it where it has got to. The request answers
  // once, minutes later; this is the only way the page can say anything true in
  // between. A missed poll is not news — the next one is two seconds away.
  useEffect(() => {
    if (working !== "generate" || !planId) { setProgress(null); return; }
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/production/plan-posts/progress?planId=${planId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setProgress(data.progress || null);
      } catch { /* ignore */ }
    };
    poll();
    setNowMs(Date.now());
    const pollId = setInterval(poll, 2000);
    const tickId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { alive = false; clearInterval(pollId); clearInterval(tickId); };
  }, [working, planId]);

  // Returning to the tab refreshes quietly — but not more than once a minute;
  // window focus fires on every alt-tab and each analyse is a real request.
  useEffect(() => {
    const onFocus = () => {
      if (planId && Date.now() - lastAnalysedRef.current > 60_000) analyse();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [planId, analyse]);

  // Straight to Drive, one file per request — the Supabase detour these used
  // to take is the store that is nearly full, and it was eating the uploads.
  const addPhotos = async (files: FileList) => {
    setWorking("photos");
    setNotice(null);
    const list = Array.from(files);
    let added = 0, cleaned = 0;
    const needsHuman: string[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setUploadPct(Math.round((i / list.length) * 100));
        const fd = new FormData();
        fd.append("planId", planId);
        fd.append("file", list[i]);
        const res = await fetch("/api/production/plan-posts/photos", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) { failures.push(`${list[i].name}: ${data.error || "failed"}`); continue; }
        added++;
        if (data.cleaned) cleaned++;
        if (data.needsHuman) needsHuman.push(list[i].name);
      }
      const lines = [`${added} of ${list.length} photo(s) added — filed to Google Drive.`];
      if (cleaned > 0) lines.push(`${cleaned} had branding cropped away to leave just the product.`);
      if (needsHuman.length) {
        lines.push(`Text sits across the jewellery in: ${needsHuman.join(", ")}. Cropping cannot remove that — supply a clean photo for these.`);
      }
      if (failures.length) lines.push(`Failed: ${failures.join(" · ")}`);
      setNotice({ ok: failures.length === 0 && needsHuman.length === 0, text: lines.join("\n") });
      await analyse();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setWorking(""); setUploadPct(0); }
  };

  const generate = async () => {
    setWorking("generate");
    setNotice(null);
    try {
      const paired = await fetch("/api/production/plan-posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "pair" }),
      });
      const pairData = await paired.json();
      if (!paired.ok) throw new Error(pairData.error || "Could not pair the photos");

      const res = await fetch("/api/production/plan-posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "generate", pairing: pairData.pairing, items: picked, styleCategory: styleSel ?? analysis?.styleCategory ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setNotice({ ok: data.success, text: [data.message, ...(data.notes || [])].join("\n") });
      await analyse();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setWorking(""); }
  };

  const shortOfPhotos = analysis ? Math.max(0, analysis.photosRequired - analysis.photos.length) : 0;

  // Real counts only. The bar moves when a frame is finished and at no other
  // time — a bar that animates itself would keep crawling forward through a run
  // that had already died, which is worse than the spinner it replaces.
  const buildPct = progress && progress.totalFrames > 0
    ? Math.round((progress.doneFrames / progress.totalFrames) * 100)
    : 0;
  const elapsedS = progress ? Math.max(0, Math.round((nowMs - Date.parse(progress.startedAt)) / 1000)) : 0;
  const quietS = progress ? Math.max(0, Math.round((nowMs - Date.parse(progress.updatedAt)) / 1000)) : 0;
  const stalled = !!progress && !progress.finished && quietS * 1000 > STALE_MS;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Wand2 className="w-6 h-6 text-[var(--yellow)]" /><span>Plan → Posts</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Reads a month&apos;s plan, tells you which product photos it needs, then builds every static post and files it
          in Creative Approvals. Nothing publishes on its own.
        </p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start gap-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="whitespace-pre-wrap">{notice.text}</span>
        </div>
      )}

      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer focus:outline-none focus:border-indigo-500">
            <option value="">— Select client —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Month plan</label>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!clientId}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer focus:outline-none focus:border-indigo-500 disabled:opacity-50">
            {plans.length === 0 && <option value="">No plans for this client</option>}
            {plans.map((p) => <option key={p.id} value={p.id}>{String(p.month).slice(0, 7)} · {p.status}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
            <span>Style {styleSel === null && analysis?.styleCategory ? <span className="text-indigo-400 normal-case">(client default)</span> : null}</span>
            <button onClick={analyse} disabled={loading || !planId} title="Sync with Style Library — pull the latest uploaded looks"
              className="p-1 min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 rounded text-indigo-400 hover:text-indigo-300 cursor-pointer disabled:opacity-40">
              <RefreshCw className={`w-3 h-3 ${loading || refreshing ? "animate-spin" : ""}`} />
            </button>
          </label>
          <select value={styleSel ?? analysis?.styleCategory ?? ""} onChange={(e) => setStyleSel(e.target.value)} disabled={!planId}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer focus:outline-none focus:border-indigo-500 disabled:opacity-50">
            <option value="">Auto — AI styles it from the plan + Brand Brain</option>
            {["traditional", "modern", "surreal", "boutique"].map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}{analysis?.styleCounts?.[k] ? ` · ${analysis.styleCounts[k]} of your proven looks` : " · empty — upload designs first"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>}

      {analysis && !loading && (
        <>
          {analysis.looksGeneric && (
            <div className="bg-amber-950/25 border border-amber-900/60 rounded-xl p-4 text-xs text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>These rows look like generated placeholders, not an authored plan</b> — every slot is
                near-identical and none carries production direction. If you imported a plan for this month,
                it was never saved: go to <Link href="/dashboard/planning" className="underline font-bold">Campaign Planning</Link>,
                re-upload the file, and press <b>&ldquo;Keep my slots&rdquo;</b> (it saves immediately now).
                Building from these rows would spend money on posts nobody designed.
              </span>
            </div>
          )}
          {analysis.driveConnected === false && (
            <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl p-3 text-xs text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Google Drive isn&apos;t connected — finished posts are saved there, so nothing can be built.{" "}
                <Link href="/dashboard/settings/integrations" className="underline font-bold">Reconnect it under Integrations</Link>.
                {analysis.driveError ? <> Reason: {analysis.driveError}</> : null}
              </span>
            </div>
          )}

          {analysis.driveQuota && analysis.driveQuota.percent !== null && analysis.driveQuota.percent >= 85 && (
            <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Google Drive is {analysis.driveQuota.percent}% full ({analysis.driveQuota.usedGb} GB of {analysis.driveQuota.limitGb} GB).
                Uploads start failing when it runs out — clear space before building a batch.
              </span>
            </div>
          )}

          {!analysis.imagesReady && (
            <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>No image key on the server — add <span className="font-mono">OPENROUTER_API_KEY</span> (or <span className="font-mono">OPENAI_API_KEY</span>) to the .env. Product posts would still build, but the generated ones can&apos;t.</span>
            </div>
          )}

          {/* What this plan needs */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Images className="w-4 h-4 text-[var(--yellow)]" />
              <span>{analysis.clientName} · {analysis.month.slice(0, 7)} — {analysis.total} posts</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Need your photos", value: analysis.needPhoto, cls: "text-amber-400" },
                { label: "Photos required", value: analysis.photosRequired, cls: "text-white" },
                { label: "Fully generated", value: analysis.generated, cls: "text-emerald-400" },
                { label: "Reels (not made here)", value: analysis.skippedReels, cls: "text-slate-500" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-950/60 border border-slate-900 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
                  <h4 className={`text-2xl font-extrabold ${s.cls}`}>{s.value}</h4>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Posts showing real merchandise are built from your photographs — the product is never redrawn. Festival,
              offer and quote posts have no product in them, so those are generated outright.
            </p>
          </div>

          {/* Photos */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-[var(--yellow)]" /><span>Product photos</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${shortOfPhotos > 0 ? "bg-amber-950/40 border-amber-900 text-amber-400" : "bg-emerald-950/40 border-emerald-900 text-emerald-400"}`}>
                  {analysis.photos.length} of {analysis.photosRequired}
                </span>
              </h3>
              <button onClick={() => photoRef.current?.click()} disabled={working !== ""}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] lg:min-h-0 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50">
                {working === "photos" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                <span>{working === "photos" ? `${uploadPct}%` : "Add photos"}</span>
              </button>
              <input ref={photoRef} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.heic" multiple className="hidden"
                onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ""; }} />
            </div>

            {shortOfPhotos > 0 ? (
              <p className="text-[11px] text-amber-300">
                {shortOfPhotos} more photo{shortOfPhotos === 1 ? "" : "s"} needed before every product post can be built.
              </p>
            ) : analysis.photos.length > 0 ? (
              <p className="text-[11px] text-emerald-300">Enough photos to build every product post.</p>
            ) : null}

            {analysis.photos.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {analysis.photos.map((p) => (
                  <div key={p.id} className="relative rounded-lg overflow-hidden border border-slate-800" title={p.description || p.file_name || ""}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_url} alt="" className="w-full aspect-square object-cover" />
                    <span className="absolute top-0.5 left-0.5 text-[9px] font-black bg-black/70 text-white rounded px-1">{p.seq}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* The plan, post by post */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h3 className="text-sm font-bold text-white">
                Pick what to build
                <span className="ml-2 text-[10px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">
                  {picked.length} of {analysis.specs.length}
                </span>
              </h3>
              <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold">
                <button onClick={() => setPicked(analysis.specs.map((s) => s.item))}
                  className="min-h-[40px] lg:min-h-0 text-slate-400 hover:text-white cursor-pointer">Select all</button>
                <span className="text-slate-700">·</span>
                <button onClick={() => setPicked([])}
                  className="min-h-[40px] lg:min-h-0 text-slate-400 hover:text-white cursor-pointer">Clear</button>
                <span className="text-slate-700">·</span>
                <button onClick={() => setPicked(analysis.specs.slice(0, 2).map((s) => s.item))}
                  className="min-h-[40px] lg:min-h-0 text-indigo-400 hover:text-indigo-300 cursor-pointer">Just the first 2</button>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 mb-1">
              Start with one or two while you are judging the templates — each build costs real money and takes a
              minute or so per post.
            </p>
            {analysis.specs.map((s) => (
              <div key={s.item} className="space-y-1">
              <label
                className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 sm:gap-y-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${picked.includes(s.item) ? "border-indigo-600 bg-indigo-950/20" : "border-slate-900 bg-slate-950/60 hover:border-slate-800"}`}>
                <input type="checkbox" checked={picked.includes(s.item)}
                  onChange={(e) => setPicked((prev) => e.target.checked ? [...prev, s.item] : prev.filter((n) => n !== s.item))}
                  className="shrink-0 accent-indigo-500 cursor-pointer" />
                <span className="text-[10px] font-mono text-slate-600 w-6 shrink-0">{s.item + 1}</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 border ${s.kind === "product" ? "bg-amber-950/40 border-amber-900 text-amber-400" : "bg-emerald-950/40 border-emerald-900 text-emerald-400"}`}>
                  {s.kind === "product" ? "PHOTO" : "GENERATED"}
                </span>
                <span className="text-xs text-white truncate flex-1 min-w-[140px] sm:min-w-0" title={s.reason}>{s.headline || "(untitled)"}</span>
                <span className="text-[10px] text-slate-500 shrink-0 capitalize">{s.contentType}{s.frames > 1 ? ` ×${s.frames}` : ""}</span>
                <span className="text-[10px] font-mono text-slate-600 shrink-0">{s.date?.slice(5) || "—"}</span>
              </label>
              {/* The exact prompt this post sends to the image model — visible
                  before Build, because after Build it has already been paid for. */}
              {s.imagePrompt && (
                <details className="ml-9 rounded-lg border border-slate-900 bg-slate-950/40">
                  <summary className="px-3 py-1.5 text-[10px] font-bold text-slate-500 hover:text-white cursor-pointer list-none">
                    ▸ Image prompt — sent to {analysis.imageModel || "the image model"} on Build
                  </summary>
                  <div className="px-3 pb-2 space-y-1.5">
                    <pre className="text-[10px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed bg-slate-950 border border-slate-900 rounded-lg p-2.5">{s.imagePrompt}</pre>
                    <button type="button"
                      onClick={() => navigator.clipboard.writeText(s.imagePrompt!)}
                      className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 cursor-pointer">
                      Copy prompt
                    </button>
                  </div>
                </details>
              )}
              {s.kind === "product" && (
                <p className="ml-9 text-[9px] text-slate-700">No image is generated for this one — your product photo is used as-is, with the type composited on.</p>
              )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-slate-500">
              {analysis.alreadyMade.length > 0 && `${analysis.alreadyMade.length} creative(s) already made from this plan. `}
              Everything lands in Creative Approvals for a human to review.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/dashboard/creatives-review"
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-600 text-[11px] font-bold">
                Creative Approvals <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <button onClick={generate} disabled={working !== "" || !analysis.imagesReady || picked.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                {working === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>
                  {working === "generate"
                    ? progress && progress.totalFrames > 0 ? `Building… ${buildPct}%` : "Building…"
                    : picked.length === 0
                    ? "Pick a post to build"
                    : `Build ${picked.length} post${picked.length === 1 ? "" : "s"}`}
                </span>
              </button>
            </div>

            {/* What the build itself says it is doing. The server log always knew;
                this is the first time the founder can see it. */}
            {working === "generate" && (
              <div className="space-y-1.5 pt-1">
                <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${buildPct}%` }} />
                </div>
                <p className="text-[11px] text-slate-400">
                  {progress
                    ? `${progress.doneFrames} of ${progress.totalFrames || "?"} frame${progress.totalFrames === 1 ? "" : "s"} · ${buildPct}% · ${progress.step}`
                    : "Starting the build…"}
                  {` · ${elapsedS}s elapsed`}
                </p>
                {stalled && (
                  <p className="text-[11px] text-amber-300">
                    No movement for {quietS}s — the image model may be slow, or this run may have stopped. The page will say when it finishes.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
