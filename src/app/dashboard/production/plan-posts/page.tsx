"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadDirect } from "@/lib/direct-upload";
import {
  Sparkles, Loader2, CheckCircle2, AlertTriangle, UploadCloud, Images,
  ArrowRight, Camera, Wand2,
} from "lucide-react";

interface SpecRow {
  item: number; date: string | null; platform: string; contentType: string;
  kind: "product" | "generated"; frames: number; headline: string; reason: string;
}
interface PhotoRow { id: string; seq: number; image_url: string; file_name: string | null; description: string | null }

export default function PlanPostsPage() {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<{ id: string; month: string; status: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [planId, setPlanId] = useState("");

  const [analysis, setAnalysis] = useState<{
    clientName: string; month: string; total: number; needPhoto: number;
    photosRequired: number; generated: number; skippedReels: number;
    specs: SpecRow[]; photos: PhotoRow[]; alreadyMade: { id: string }[]; imagesReady: boolean;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<"" | "photos" | "generate">("");
  const [uploadPct, setUploadPct] = useState(0);
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
    })();
  }, [clientId]);

  const analyse = useCallback(async () => {
    if (!planId) { setAnalysis(null); return; }
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/production/plan-posts?planId=${planId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the plan");
      setAnalysis(data);
      setPicked([]);
    } catch (err: unknown) {
      setAnalysis(null);
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setLoading(false); }
  }, [planId]);

  useEffect(() => { analyse(); }, [analyse]);

  const addPhotos = async (files: FileList) => {
    setWorking("photos");
    setNotice(null);
    try {
      const uploaded: { url: string; fileName: string }[] = [];
      const list = Array.from(files);
      for (let i = 0; i < list.length; i++) {
        const up = await uploadDirect(list[i], "social", (p) =>
          setUploadPct(Math.round(((i + p / 100) / list.length) * 100)));
        uploaded.push({ url: up.url, fileName: up.fileName });
      }
      const res = await fetch("/api/production/plan-posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "photos", photos: uploaded }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the photos");
      setNotice({ ok: true, text: `${data.added} photo(s) added. They'll be paired to the posts that need them.` });
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
        body: JSON.stringify({ planId, action: "generate", pairing: pairData.pairing, items: picked }),
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

      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
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
      </div>

      {loading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>}

      {analysis && !loading && (
        <>
          {!analysis.imagesReady && (
            <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Add <span className="font-mono">OPENAI_API_KEY</span> to the server .env — without it the generated posts can&apos;t be made.</span>
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
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50">
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
              <div className="flex items-center gap-2 text-[10px] font-bold">
                <button onClick={() => setPicked(analysis.specs.map((s) => s.item))}
                  className="text-slate-400 hover:text-white cursor-pointer">Select all</button>
                <span className="text-slate-700">·</span>
                <button onClick={() => setPicked([])}
                  className="text-slate-400 hover:text-white cursor-pointer">Clear</button>
                <span className="text-slate-700">·</span>
                <button onClick={() => setPicked(analysis.specs.slice(0, 2).map((s) => s.item))}
                  className="text-indigo-400 hover:text-indigo-300 cursor-pointer">Just the first 2</button>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 mb-1">
              Start with one or two while you are judging the templates — each build costs real money and takes a
              minute or so per post.
            </p>
            {analysis.specs.map((s) => (
              <label key={s.item}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${picked.includes(s.item) ? "border-indigo-600 bg-indigo-950/20" : "border-slate-900 bg-slate-950/60 hover:border-slate-800"}`}>
                <input type="checkbox" checked={picked.includes(s.item)}
                  onChange={(e) => setPicked((prev) => e.target.checked ? [...prev, s.item] : prev.filter((n) => n !== s.item))}
                  className="shrink-0 accent-indigo-500 cursor-pointer" />
                <span className="text-[10px] font-mono text-slate-600 w-6 shrink-0">{s.item + 1}</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 border ${s.kind === "product" ? "bg-amber-950/40 border-amber-900 text-amber-400" : "bg-emerald-950/40 border-emerald-900 text-emerald-400"}`}>
                  {s.kind === "product" ? "PHOTO" : "GENERATED"}
                </span>
                <span className="text-xs text-white truncate flex-1" title={s.reason}>{s.headline || "(untitled)"}</span>
                <span className="text-[10px] text-slate-500 shrink-0 capitalize">{s.contentType}{s.frames > 1 ? ` ×${s.frames}` : ""}</span>
                <span className="text-[10px] font-mono text-slate-600 shrink-0">{s.date?.slice(5) || "—"}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-slate-500">
              {analysis.alreadyMade.length > 0 && `${analysis.alreadyMade.length} creative(s) already made from this plan. `}
              Everything lands in Creative Approvals for a human to review.
            </p>
            <div className="flex items-center gap-2">
              <Link href="/dashboard/creatives-review"
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-600 text-[11px] font-bold">
                Creative Approvals <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <button onClick={generate} disabled={working !== "" || !analysis.imagesReady || picked.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                {working === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>
                  {working === "generate"
                    ? "Building…"
                    : picked.length === 0
                    ? "Pick a post to build"
                    : `Build ${picked.length} post${picked.length === 1 ? "" : "s"}`}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
