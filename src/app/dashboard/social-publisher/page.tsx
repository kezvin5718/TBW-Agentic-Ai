"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send, Loader2, UploadCloud, Sparkles, Image as ImageIcon, CheckCircle2, AlertTriangle, Settings, Clock } from "lucide-react";

interface ClientRow { id: string; name: string }
interface HubUpload {
  id: string; client_id: string; file_url: string; file_name: string | null;
  media_type: string; content_type: "post" | "reel" | "story"; status: string;
  created_at: string; clients?: { name: string } | null; profiles?: { name: string } | null;
}
interface PostRow {
  id: string; platform: string; content_type: string; title: string | null; caption: string | null;
  media_url: string; thumbnail_url: string | null; scheduled_for: string | null; status: string;
  created_at: string; clients?: { name: string } | null; profiles?: { name: string } | null;
}

const PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "pinterest", label: "Pinterest" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
];
const TYPES = ["post", "reel", "story"] as const;

export default function SocialPublisherPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [myRole, setMyRole] = useState<string>("employee");

  // form state
  const [clientId, setClientId] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram"]);
  const [contentTypes, setContentTypes] = useState<string[]>(["post"]);

  // Content Hub tray
  const [hubUploads, setHubUploads] = useState<HubUpload[]>([]);
  const [hubFilter, setHubFilter] = useState<string>("all");
  const [selectedUpload, setSelectedUpload] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [captionBrief, setCaptionBrief] = useState("");
  const [aiModel, setAiModel] = useState<"chatgpt" | "gemini">("chatgpt");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [mediaIsVideo, setMediaIsVideo] = useState(false);
  const [thumbUrl, setThumbUrl] = useState("");
  const [scheduledDate, setScheduledDate] = useState(""); // YYYY-MM-DD
  const [scheduledTime, setScheduledTime] = useState(""); // HH:mm

  // Compose the schedule (empty = post now). Date without time defaults to 10:00;
  // time without date defaults to today.
  const composeSchedule = (): string => {
    if (!scheduledDate && !scheduledTime) return "";
    const d = scheduledDate || new Date().toISOString().slice(0, 10);
    const t = scheduledTime || "10:00";
    return `${d}T${t}`;
  };

  const pad = (n: number) => String(n).padStart(2, "0");
  const applyPreset = (preset: "now" | "plus1h" | "tonight" | "tomorrow10") => {
    const now = new Date();
    if (preset === "now") { setScheduledDate(""); setScheduledTime(""); return; }
    const d = new Date(now);
    if (preset === "plus1h") d.setHours(d.getHours() + 1);
    if (preset === "tonight") d.setHours(19, 0, 0, 0);
    if (preset === "tomorrow10") { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setScheduledTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  // Clicking anywhere on the field opens the native calendar / clock picker.
  const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try { el.showPicker?.(); } catch { /* browser needs direct interaction — fine */ }
  };

  // ui state
  const [uploading, setUploading] = useState<"media" | "thumb" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [hookConfigured, setHookConfigured] = useState(true);
  const [hookUrl, setHookUrl] = useState("");
  const [savingHook, setSavingHook] = useState(false);
  const mediaRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/social-publisher");
      if (res.ok) setPosts((await res.json()).posts || []);
    } catch { /* ignore */ }
  }, []);

  const loadHubUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/content-hub");
      if (res.ok) {
        const data = await res.json();
        setHubUploads(((data.uploads || []) as HubUpload[]).filter((u) => u.status === "uploaded"));
      }
    } catch { /* ignore */ }
  }, []);

  // Fill the composer from a Content Hub item: client, media and content type auto-select.
  const applyHubUpload = (u: HubUpload) => {
    setClientId(u.client_id);
    setMediaUrl(u.file_url);
    setMediaName(u.file_name || "Content Hub file");
    setMediaIsVideo(u.media_type === "video");
    setContentTypes([u.content_type]);
    setSelectedUpload({ id: u.id, name: u.file_name || "Content Hub file" });
    setNotice({ ok: true, text: `Loaded "${u.file_name}" for ${u.clients?.name || "client"} — type auto-set to ${u.content_type}.` });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Content type: select 1 or 2 (e.g. Reel + Story).
  const toggleType = (t: string) =>
    setContentTypes((prev) => {
      if (prev.includes(t)) return prev.length > 1 ? prev.filter((x) => x !== t) : prev;
      return prev.length >= 2 ? [prev[1], t] : [...prev, t];
    });

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setMyRole((user?.user_metadata?.role as string) || "employee");
      const { data } = await supabase.from("clients").select("id, name").order("name");
      setClients(data || []);
      try {
        const res = await fetch("/api/social-publisher/settings");
        if (res.ok) {
          const s = await res.json();
          setHookConfigured(!!s.configured);
          if (s.url) setHookUrl(s.url);
        }
      } catch { /* ignore */ }
    })();
    loadHistory();
    loadHubUploads();
  }, [loadHistory, loadHubUploads]);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const upload = async (kind: "media" | "thumb", file: File) => {
    setUploading(kind);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/social-publisher/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      if (kind === "media") { setMediaUrl(data.url); setMediaName(data.fileName); setMediaIsVideo(data.mediaType === "video"); }
      else setThumbUrl(data.url);
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally { setUploading(null); }
  };

  const generateCaption = async () => {
    if (!clientId) { setNotice({ ok: false, text: "Select a client first — the caption uses that brand's brain." }); return; }
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher/generate-caption", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, platform: platforms[0], contentType: contentTypes[0], brief: captionBrief, model: aiModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setCaption(data.caption);
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Generation failed" });
    } finally { setGenerating(false); }
  };

  const submit = async () => {
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, platforms, contentTypes, title, caption, mediaUrl, thumbnailUrl: thumbUrl || undefined, scheduledFor: composeSchedule(), uploadId: selectedUpload?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      const okCount = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      const failCount = (data.results || []).length - okCount;
      setNotice({ ok: failCount === 0, text: failCount === 0 ? `Sent to Zapier for ${okCount} platform(s) ✅` : `${okCount} sent, ${failCount} failed — see history below.` });
      if (failCount === 0) { setTitle(""); setCaption(""); setCaptionBrief(""); setMediaUrl(""); setMediaName(""); setThumbUrl(""); setScheduledDate(""); setScheduledTime(""); setSelectedUpload(null); }
      await loadHistory();
      await loadHubUploads();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Send failed" });
    } finally { setSending(false); }
  };

  const saveHook = async () => {
    setSavingHook(true);
    try {
      const res = await fetch("/api/social-publisher/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hookUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setHookConfigured(true);
      setNotice({ ok: true, text: "Zapier webhook saved." });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally { setSavingHook(false); }
  };

  const canSend = !!clientId && platforms.length > 0 && contentTypes.length > 0 && !!mediaUrl && !sending;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Send className="w-6 h-6 text-[var(--yellow)]" /><span>Social Publisher</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Pick the client, upload the creative, generate an on-brand caption, set the time — it fires your Zapier posting workflow.</p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-center space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Founder: webhook settings (shown until configured, expandable after) */}
      {myRole === "founder" && (
        <details className="bg-slate-950/40 border border-slate-900 rounded-2xl" open={!hookConfigured}>
          <summary className="p-4 cursor-pointer text-xs font-bold text-slate-400 flex items-center space-x-2 list-none">
            <Settings className="w-4 h-4" /><span>Zapier Webhook {hookConfigured ? "· configured ✅" : "· NOT CONFIGURED"}</span>
          </summary>
          <div className="px-4 pb-4 flex gap-2">
            <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
            <button onClick={saveHook} disabled={savingHook} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold cursor-pointer disabled:opacity-50">
              {savingHook ? "Saving…" : "Save"}
            </button>
          </div>
        </details>
      )}

      {/* Received from Content Hub — what designers have delivered, per client */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <UploadCloud className="w-4 h-4 text-[var(--yellow)]" />
            <span>Received from Content Hub</span>
            {hubUploads.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-400">{hubUploads.length} waiting</span>}
          </h3>
          {hubUploads.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setHubFilter("all")} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer ${hubFilter === "all" ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>All</button>
              {Array.from(new Set(hubUploads.map((u) => u.clients?.name || "Unknown"))).map((n) => (
                <button key={n} onClick={() => setHubFilter(n)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer ${hubFilter === n ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>{n}</button>
              ))}
            </div>
          )}
        </div>
        {hubUploads.length === 0 ? (
          <p className="text-xs text-slate-600 py-3 text-center">Nothing waiting — new designer uploads will appear here, grouped by client.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {hubUploads.filter((u) => hubFilter === "all" || (u.clients?.name || "Unknown") === hubFilter).map((u) => (
              <div key={u.id} className={`rounded-xl border p-3 space-y-2 ${selectedUpload?.id === u.id ? "border-indigo-500 bg-indigo-950/20" : "border-slate-900 bg-slate-950/60"}`}>
                <div className="flex items-center space-x-2.5">
                  <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shrink-0 flex items-center justify-center">
                    {u.media_type === "video" ? <span className="text-slate-500">▶</span> : <img src={u.file_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-white truncate">{u.file_name || "file"}</p>
                    <p className="text-[10px] text-slate-500 truncate">{u.clients?.name || "—"} · <span className="capitalize text-[var(--yellow)]">{u.content_type}</span></p>
                    <p className="text-[9px] text-slate-600">by {u.profiles?.name || "—"} · {new Date(u.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <button onClick={() => applyHubUpload(u)} className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold cursor-pointer">
                  {selectedUpload?.id === u.id ? "Loaded ✓" : "Use this →"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-5">
        {/* 1. Client + platforms + type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Client / Brand</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Content Type <span className="text-slate-600 normal-case font-medium">(pick 1–2, e.g. Reel + Story)</span></label>
            <div className="flex gap-2">
              {TYPES.map((t) => (
                <button key={t} onClick={() => toggleType(t)} className={`px-4 py-2 rounded-full text-xs font-bold border capitalize cursor-pointer transition-all ${contentTypes.includes(t) ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Platforms (select one or more)</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p.key} onClick={() => togglePlatform(p.key)} className={`px-4 py-2 rounded-full text-xs font-bold border cursor-pointer transition-all ${platforms.includes(p.key) ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Media + thumbnail */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Media (image / video) *</label>
            <div onClick={() => mediaRef.current?.click()} className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-colors">
              {uploading === "media" ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--yellow)]" /> :
                mediaUrl ? (
                  <div className="flex items-center justify-center space-x-2 text-emerald-400 text-xs font-bold"><CheckCircle2 className="w-4 h-4" /><span className="truncate max-w-[200px]">{mediaName || "Uploaded"}</span></div>
                ) : (
                  <div className="text-slate-500 text-xs"><UploadCloud className="w-5 h-5 mx-auto mb-1" />Click to upload</div>
                )}
            </div>
            <input ref={mediaRef} type="file" accept="image/*,video/mp4,video/quicktime" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("media", f); e.target.value = ""; }} />
            {mediaUrl && !mediaIsVideo && <img src={mediaUrl} alt="preview" className="mt-2 h-24 rounded-lg object-cover border border-slate-800" />}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Thumbnail (optional — for reels/video)</label>
            <div onClick={() => thumbRef.current?.click()} className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-colors">
              {uploading === "thumb" ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--yellow)]" /> :
                thumbUrl ? (
                  <div className="flex items-center justify-center space-x-2 text-emerald-400 text-xs font-bold"><CheckCircle2 className="w-4 h-4" /><span>Thumbnail set</span></div>
                ) : (
                  <div className="text-slate-500 text-xs"><ImageIcon className="w-5 h-5 mx-auto mb-1" />Click to upload</div>
                )}
            </div>
            <input ref={thumbRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("thumb", f); e.target.value = ""; }} />
            {thumbUrl && <img src={thumbUrl} alt="thumb" className="mt-2 h-24 rounded-lg object-cover border border-slate-800" />}
          </div>
        </div>

        {/* 3. Title + caption with AI */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunset Photography"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Caption</label>
            <div className="flex items-center gap-2">
              <select value={aiModel} onChange={(e) => setAiModel(e.target.value as "chatgpt" | "gemini")} className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                <option value="chatgpt">ChatGPT (GPT-4o)</option>
                <option value="gemini">Gemini</option>
              </select>
              <button onClick={generateCaption} disabled={generating} className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-xs font-bold cursor-pointer disabled:opacity-50">
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>{generating ? "Writing…" : "Generate from Brand Brain"}</span>
              </button>
            </div>
          </div>
          <input value={captionBrief} onChange={(e) => setCaptionBrief(e.target.value)} placeholder="Optional: what is this post about? (e.g. Diwali offer on gold necklaces)"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="Write the caption, or generate it from the brand's brain…"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed" />
        </div>

        {/* 4. Schedule + send */}
        <div className="border-t border-slate-900 pt-4 space-y-3">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1"><Clock className="w-3 h-3" /><span>When to post</span></label>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            {[
              { k: "now" as const, label: "🚀 Post now" },
              { k: "plus1h" as const, label: "+1 hour" },
              { k: "tonight" as const, label: "Tonight 7 PM" },
              { k: "tomorrow10" as const, label: "Tomorrow 10 AM" },
            ].map((p) => (
              <button key={p.k} type="button" onClick={() => applyPreset(p.k)}
                className="px-3 py-1.5 rounded-full text-[11px] font-bold border bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-indigo-500 cursor-pointer transition-all">
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">📅 Date (click for calendar)</label>
                <input type="date" value={scheduledDate} onClick={openPicker} onChange={(e) => setScheduledDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">🕐 Time (click to pick)</label>
                <input type="time" value={scheduledTime} onClick={openPicker} onChange={(e) => setScheduledTime(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
              <div className="self-end pb-1 text-[11px] text-slate-500">
                {composeSchedule()
                  ? <>Scheduled: <span className="signal">{new Date(composeSchedule()).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></>
                  : "Posts immediately"}
              </div>
            </div>
            <button onClick={submit} disabled={!canSend} className={`px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center space-x-2 transition-all ${canSend ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{sending ? "Sending…" : `Send to Zapier (${platforms.length * contentTypes.length})`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-white mb-3">Recent Posts</h3>
        {posts.length === 0 ? (
          <p className="text-xs text-slate-600 py-6 text-center">Nothing sent yet.</p>
        ) : (
          <div className="space-y-2">
            {posts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-b border-slate-900/60 py-2 text-xs flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.status === "sent" ? "bg-emerald-400" : "bg-rose-500"}`} />
                  <span className="font-bold text-white truncate">{p.clients?.name || "—"}</span>
                  <span className="text-slate-500 capitalize">{p.platform} · {p.content_type}</span>
                  <span className="text-slate-600 truncate max-w-[220px]">{p.title || p.caption?.slice(0, 40) || ""}</span>
                </div>
                <div className="text-slate-600 shrink-0">
                  {p.scheduled_for ? `⏰ ${new Date(p.scheduled_for).toLocaleString()}` : new Date(p.created_at).toLocaleString()}
                  <span className="ml-2">{p.profiles?.name || ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
