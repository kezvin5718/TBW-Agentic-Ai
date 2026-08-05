"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send, Loader2, UploadCloud, Sparkles, Image as ImageIcon, CheckCircle2, AlertTriangle, Settings, Clock, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, Play, Eye } from "lucide-react";

interface ClientRow { id: string; name: string; logo?: string }
interface HubUpload {
  id: string; client_id: string; file_url: string; file_name: string | null;
  media_type: string; content_type: "post" | "reel" | "story"; status: string;
  qc_status?: string; qc_detected_brand?: string | null; qc_note?: string | null;
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
  // All platforms pre-selected — the team unselects what they don't want,
  // so a platform is never forgotten by mistake.
  const [platforms, setPlatforms] = useState<string[]>(PLATFORMS.map((p) => p.key));
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
  // RecurPost
  const [rpConfigured, setRpConfigured] = useState(false);
  const [rpAccounts, setRpAccounts] = useState<Array<{ id: string; name: string; platform: string }>>([]);
  const [rpMapping, setRpMapping] = useState<Record<string, { client_id: string; platform: string }>>({});
  const [rpBusy, setRpBusy] = useState(false);

  const loadRecurPost = useCallback(async () => {
    try {
      const res = await fetch("/api/recurpost/accounts");
      if (res.ok) {
        const data = await res.json();
        setRpConfigured(!!data.configured);
        setRpAccounts(data.accounts || []);
        setRpMapping(data.mapping || {});
        if (data.error) setNotice({ ok: false, text: `RecurPost: ${data.error}` });
      }
    } catch { /* ignore */ }
  }, []);

  const saveRpMapping = async () => {
    setRpBusy(true);
    try {
      const res = await fetch("/api/recurpost/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapping: rpMapping }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setNotice({ ok: true, text: "RecurPost account mapping saved." });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally { setRpBusy(false); }
  };

  const testRecurPost = async () => {
    setRpBusy(true);
    try {
      const res = await fetch("/api/recurpost/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      setNotice({ ok: true, text: "RecurPost connection OK ✅" });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "RecurPost test failed" });
    } finally { setRpBusy(false); }
  };
  const mediaRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  // --- Frame-strip thumbnail picker -----------------------------------------
  const [frames, setFrames] = useState<Array<{ t: number; url: string }>>([]);
  const [framesBusy, setFramesBusy] = useState(false);
  const [selFrame, setSelFrame] = useState<number | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const frameVideoRef = useRef<HTMLVideoElement | null>(null);

  const loadVideoEl = (src: string) =>
    new Promise<HTMLVideoElement>((resolve, reject) => {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error("Could not load the video for frame extraction."));
      v.src = src;
    });

  const seekTo = (v: HTMLVideoElement, t: number) =>
    new Promise<void>((resolve, reject) => {
      v.onseeked = () => resolve();
      v.onerror = () => reject(new Error("Seek failed"));
      v.currentTime = t;
    });

  // Build a strip of 8 evenly-spaced frames whenever a video is uploaded.
  const extractFrames = useCallback(async (src: string) => {
    setFramesBusy(true);
    setFrames([]);
    setSelFrame(null);
    try {
      const v = await loadVideoEl(src);
      frameVideoRef.current = v;
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
      const dur = v.duration || 1;
      const N = 8;
      const canvas = document.createElement("canvas");
      // Preview thumbs keep the video's true aspect — portrait stays portrait.
      const w = 200;
      canvas.width = w;
      canvas.height = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w) || 112);
      const ctx = canvas.getContext("2d")!;
      const out: Array<{ t: number; url: string }> = [];
      for (let i = 0; i < N; i++) {
        const t = Math.min(Math.max(0, dur - 0.1), (dur * (i + 0.5)) / N);
        await seekTo(v, t);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        out.push({ t, url: canvas.toDataURL("image/jpeg", 0.7) });
        setFrames([...out]); // progressive render
      }
    } catch (err: unknown) {
      setNotice({ ok: false, text: `${err instanceof Error ? err.message : "Frame extraction failed"} — you can still upload a thumbnail file manually.` });
    } finally {
      setFramesBusy(false);
    }
  }, []);

  useEffect(() => {
    if (mediaIsVideo && mediaUrl) extractFrames(mediaUrl);
    else { setFrames([]); setSelFrame(null); setVideoDims(null); frameVideoRef.current = null; }
  }, [mediaIsVideo, mediaUrl, extractFrames]);

  // Click a frame → capture it at full resolution → set as thumbnail.
  const chooseFrame = async (t: number) => {
    setSelFrame(t);
    try {
      let v = frameVideoRef.current;
      if (!v) { v = await loadVideoEl(mediaUrl); frameVideoRef.current = v; }
      await seekTo(v, t);
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not capture the frame."))), "image/jpeg", 0.92)
      );
      await upload("thumb", new File([blob], `frame-thumb-${Date.now()}.jpg`, { type: "image/jpeg" }));
      setNotice({ ok: true, text: "Frame set as thumbnail ✅" });
    } catch (err: unknown) {
      setSelFrame(null);
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Frame capture failed" });
    }
  };

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
      const { data } = await supabase.from("clients").select("id, name, logo_url").order("name");
      setClients(
        (data || []).map((c: { id: string; name: string; logo_url?: string | null }) => ({
          id: c.id,
          name: c.name,
          logo: c.logo_url
            ? c.logo_url.startsWith("http")
              ? c.logo_url
              : supabase.storage.from("brand-assets").getPublicUrl(c.logo_url).data.publicUrl
            : "",
        }))
      );
    })();
    loadHistory();
    loadHubUploads();
    loadRecurPost();
  }, [loadHistory, loadHubUploads, loadRecurPost]);

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
        body: JSON.stringify({ clientId, platforms, contentTypes, title, caption, mediaUrl, mediaIsVideo, thumbnailUrl: thumbUrl || undefined, scheduledFor: composeSchedule(), uploadId: selectedUpload?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      const okCount = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      const failCount = (data.results || []).length - okCount;
      setNotice({ ok: failCount === 0, text: failCount === 0 ? `Sent via RecurPost for ${okCount} post(s) ✅` : `${okCount} sent, ${failCount} failed — see history below.` });
      if (failCount === 0) { setTitle(""); setCaption(""); setCaptionBrief(""); setMediaUrl(""); setMediaName(""); setThumbUrl(""); setScheduledDate(""); setScheduledTime(""); setSelectedUpload(null); }
      await loadHistory();
      await loadHubUploads();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Send failed" });
    } finally { setSending(false); }
  };

  const canSend = !!clientId && platforms.length > 0 && contentTypes.length > 0 && !!mediaUrl && !sending;

  // Per-client sequence numbers for the Content Hub tray (upload order = 1,2,3…)
  const hubSeq: Record<string, number> = {};
  const hubClientTotals: Record<string, number> = {};
  {
    const byClient: Record<string, HubUpload[]> = {};
    hubUploads.forEach((u) => { (byClient[u.client_id] ||= []).push(u); });
    Object.values(byClient).forEach((list) => {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      list.forEach((u, i) => { hubSeq[u.id] = i + 1; });
      const cname = list[0]?.clients?.name || "Unknown";
      hubClientTotals[cname] = list.length;
    });
  }
  const hubSorted = [...hubUploads].sort((a, b) => {
    const ca = a.clients?.name || "", cb = b.clients?.name || "";
    return ca === cb ? (hubSeq[a.id] || 0) - (hubSeq[b.id] || 0) : ca.localeCompare(cb);
  });

  // --- Live social preview ---------------------------------------------------
  const [previewPlat, setPreviewPlat] = useState("instagram");
  const [previewType, setPreviewType] = useState("post");
  useEffect(() => { if (!platforms.includes(previewPlat)) setPreviewPlat(platforms[0] || "instagram"); }, [platforms, previewPlat]);
  useEffect(() => { if (!contentTypes.includes(previewType)) setPreviewType(contentTypes[0] || "post"); }, [contentTypes, previewType]);

  const pvClient = clients.find((c) => c.id === clientId);
  const pvName = pvClient?.name || "Your Brand";
  const pvHandle = pvName.toLowerCase().replace(/[^a-z0-9]/g, "") || "yourbrand";
  const pvCaption = caption || "Your caption will appear here…";

  const PvAvatar = ({ className }: { className: string }) =>
    pvClient?.logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={pvClient.logo} alt="" className={`${className} rounded-full object-cover border border-slate-200 bg-white`} />
    ) : (
      <div className={`${className} rounded-full bg-gradient-to-tr from-amber-400 to-pink-500 flex items-center justify-center text-white font-black text-xs`}>
        {pvName[0]?.toUpperCase() || "B"}
      </div>
    );

  const PvMedia = ({ className = "" }: { className?: string }) =>
    mediaUrl ? (
      mediaIsVideo ? (
        <video src={mediaUrl} poster={thumbUrl || undefined} muted playsInline controls className={`w-full h-full object-cover ${className}`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt="" className={`w-full h-full object-cover ${className}`} />
      )
    ) : (
      <div className={`w-full h-full flex items-center justify-center bg-slate-200 text-slate-500 text-xs ${className}`}>Upload media to preview</div>
    );

  const renderPreview = () => {
    const vertical = ["reel", "story"].includes(previewType) && ["instagram", "facebook"].includes(previewPlat);
    if (vertical) {
      return (
        <div className="relative bg-black rounded-2xl overflow-hidden shadow-xl aspect-[9/16]">
          <div className="absolute inset-0"><PvMedia /></div>
          {previewType === "story" && (
            <>
              <div className="absolute top-2 left-2 right-2 h-0.5 bg-white/30 rounded-full"><div className="w-1/3 h-full bg-white rounded-full" /></div>
              <div className="absolute top-4 left-2 flex items-center gap-2">
                <PvAvatar className="w-7 h-7" />
                <span className="text-white text-xs font-bold drop-shadow">{pvHandle}</span>
                <span className="text-white/70 text-[10px]">now</span>
              </div>
            </>
          )}
          {previewType === "reel" && (
            <>
              <div className="absolute right-2 bottom-16 flex flex-col items-center gap-4 text-white drop-shadow">
                <Heart className="w-6 h-6" /><MessageCircle className="w-6 h-6" /><Send className="w-6 h-6" />
              </div>
              <div className="absolute left-3 right-12 bottom-3 text-white drop-shadow">
                <div className="flex items-center gap-2 mb-1.5"><PvAvatar className="w-7 h-7" /><span className="text-xs font-bold">{pvHandle}</span></div>
                <p className="text-[11px] line-clamp-2">{pvCaption}</p>
              </div>
            </>
          )}
        </div>
      );
    }
    if (previewPlat === "instagram") {
      return (
        <div className="bg-white rounded-2xl overflow-hidden shadow-xl text-slate-900">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <PvAvatar className="w-8 h-8" /><span className="text-xs font-bold">{pvHandle}</span>
            <MoreHorizontal className="w-4 h-4 ml-auto text-slate-500" />
          </div>
          <div className="aspect-square bg-slate-100"><PvMedia /></div>
          <div className="px-3 pt-2.5 flex items-center gap-3 text-slate-800">
            <Heart className="w-5 h-5" /><MessageCircle className="w-5 h-5" /><Send className="w-5 h-5" /><Bookmark className="w-5 h-5 ml-auto" />
          </div>
          <div className="px-3 py-2 text-xs">
            <span className="font-bold mr-1.5">{pvHandle}</span>
            <span className="text-slate-700">{pvCaption.slice(0, 120)}{pvCaption.length > 120 ? "… more" : ""}</span>
            <p className="text-slate-400 mt-1">View all comments</p>
            <p className="text-slate-400 text-[10px] uppercase mt-0.5">Just now</p>
          </div>
        </div>
      );
    }
    if (previewPlat === "facebook") {
      return (
        <div className="bg-white rounded-2xl overflow-hidden shadow-xl text-slate-900">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <PvAvatar className="w-9 h-9" />
            <div><p className="text-xs font-bold leading-tight">{pvName}</p><p className="text-[10px] text-slate-500">Just now · 🌐</p></div>
            <MoreHorizontal className="w-4 h-4 ml-auto text-slate-500" />
          </div>
          <p className="px-3 pb-2 text-xs text-slate-800">{pvCaption.slice(0, 160)}{pvCaption.length > 160 ? "… See more" : ""}</p>
          <div className="aspect-video bg-slate-100"><PvMedia /></div>
          <div className="px-3 py-2 flex items-center justify-around text-slate-600 text-[11px] font-semibold border-t border-slate-100">
            <span className="flex items-center gap-1"><ThumbsUp className="w-4 h-4" />Like</span>
            <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4" />Comment</span>
            <span className="flex items-center gap-1"><Send className="w-4 h-4" />Share</span>
          </div>
        </div>
      );
    }
    if (previewPlat === "pinterest") {
      return (
        <div className="bg-white rounded-3xl overflow-hidden shadow-xl text-slate-900">
          <div className="aspect-[3/4] bg-slate-100"><PvMedia /></div>
          <div className="px-3 py-2.5">
            <p className="text-sm font-bold leading-snug">{title || pvCaption.slice(0, 60)}</p>
            <div className="flex items-center gap-2 mt-2"><PvAvatar className="w-6 h-6" /><span className="text-[11px] text-slate-600">{pvName}</span></div>
          </div>
        </div>
      );
    }
    if (previewPlat === "linkedin") {
      return (
        <div className="bg-white rounded-2xl overflow-hidden shadow-xl text-slate-900">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <PvAvatar className="w-9 h-9" />
            <div><p className="text-xs font-bold leading-tight">{pvName}</p><p className="text-[10px] text-slate-500">Marketing · Just now</p></div>
          </div>
          <p className="px-3 pb-2 text-xs text-slate-800">{pvCaption.slice(0, 180)}{pvCaption.length > 180 ? "… see more" : ""}</p>
          <div className="aspect-video bg-slate-100"><PvMedia /></div>
          <div className="px-3 py-2 flex items-center justify-around text-slate-600 text-[11px] font-semibold border-t border-slate-100">
            <span className="flex items-center gap-1"><ThumbsUp className="w-4 h-4" />Like</span>
            <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4" />Comment</span>
            <span className="flex items-center gap-1"><Send className="w-4 h-4" />Send</span>
          </div>
        </div>
      );
    }
    // youtube
    return (
      <div className="bg-white rounded-2xl overflow-hidden shadow-xl text-slate-900">
        <div className="relative aspect-video bg-slate-900">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <PvMedia />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-8 bg-red-600 rounded-lg flex items-center justify-center"><Play className="w-4 h-4 text-white fill-white" /></div>
          </div>
        </div>
        <div className="px-3 py-2.5 flex gap-2">
          <PvAvatar className="w-8 h-8 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold leading-snug line-clamp-2">{title || "Your video title"}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{pvName} · 0 views · just now</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Send className="w-6 h-6 text-[var(--yellow)]" /><span>Social Publisher</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Pick the client, upload the creative, generate an on-brand caption, set the time — it posts through RecurPost to your connected accounts.</p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-center space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Posting connection status */}
      {rpConfigured && (
        <div className="bg-emerald-950/20 border border-emerald-900/50 rounded-xl p-3 text-xs text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Posting via <b>RecurPost</b> — direct to your connected social accounts.</span>
        </div>
      )}

      {/* Founder: RecurPost account → client mapping */}
      {myRole === "founder" && rpConfigured && (
        <details className="bg-slate-950/40 border border-slate-900 rounded-2xl">
          <summary className="p-4 cursor-pointer text-xs font-bold text-slate-400 flex items-center space-x-2 list-none">
            <Settings className="w-4 h-4" /><span>RecurPost Accounts — map each social account to a client ({Object.keys(rpMapping).length} mapped)</span>
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <div className="flex gap-2">
              <button onClick={testRecurPost} disabled={rpBusy} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-[11px] font-bold cursor-pointer disabled:opacity-50">Test connection</button>
              <button onClick={loadRecurPost} disabled={rpBusy} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-[11px] font-bold cursor-pointer disabled:opacity-50">Refresh accounts</button>
            </div>
            {rpAccounts.length === 0 ? (
              <p className="text-[11px] text-slate-600">No accounts returned — connect accounts inside RecurPost first, then Refresh.</p>
            ) : (
              rpAccounts.map((a) => {
                const m = rpMapping[a.id] || { client_id: "", platform: a.platform || "" };
                return (
                  <div key={a.id} className="flex items-center gap-2 flex-wrap border-b border-slate-900/60 py-2">
                    <span className="text-[11px] font-bold text-white min-w-[160px] truncate">{a.name}</span>
                    <span className="text-[10px] text-slate-500 capitalize min-w-[70px]">{a.platform || "?"}</span>
                    <select value={m.client_id} onChange={(e) => setRpMapping((p) => ({ ...p, [a.id]: { ...m, client_id: e.target.value } }))} className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                      <option value="">— client —</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={m.platform} onChange={(e) => setRpMapping((p) => ({ ...p, [a.id]: { ...m, platform: e.target.value } }))} className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                      <option value="">— platform —</option>
                      {PLATFORMS.map((pl) => <option key={pl.key} value={pl.key}>{pl.label}</option>)}
                    </select>
                  </div>
                );
              })
            )}
            {rpAccounts.length > 0 && (
              <button onClick={saveRpMapping} disabled={rpBusy} className="mt-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold cursor-pointer disabled:opacity-50">
                {rpBusy ? "Saving…" : "Save mapping"}
              </button>
            )}
          </div>
        </details>
      )}

      {/* RecurPost not configured yet — server env missing */}
      {!rpConfigured && (
        <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-xs text-amber-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>RecurPost is not configured — add <span className="font-mono">RECURPOST_EMAIL</span> and <span className="font-mono">RECURPOST_API_KEY</span> to the server <span className="font-mono">.env</span> and redeploy.</span>
        </div>
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
              {Array.from(new Set(hubUploads.map((u) => u.clients?.name || "Unknown"))).sort().map((n) => (
                <button key={n} onClick={() => setHubFilter(n)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer ${hubFilter === n ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>
                  {n} <span className="font-black">({hubClientTotals[n] || 0})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {hubUploads.length === 0 ? (
          <p className="text-xs text-slate-600 py-3 text-center">Nothing waiting — new designer uploads will appear here, grouped by client.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {hubSorted.filter((u) => hubFilter === "all" || (u.clients?.name || "Unknown") === hubFilter).map((u) => (
              <div key={u.id} className={`rounded-xl border p-3 space-y-2 ${selectedUpload?.id === u.id ? "border-indigo-500 bg-indigo-950/20" : "border-slate-900 bg-slate-950/60"}`}>
                <div className="flex items-center space-x-2.5">
                  <span className="w-7 h-7 rounded-full bg-[var(--yellow)] text-black text-[11px] font-black flex items-center justify-center shrink-0" title={`Item ${hubSeq[u.id]} of ${u.clients?.name || "client"}'s ${hubClientTotals[u.clients?.name || "Unknown"] || 0} waiting`}>
                    {hubSeq[u.id]}
                  </span>
                  <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shrink-0 flex items-center justify-center">
                    {u.media_type === "video" ? <span className="text-slate-500">▶</span> : <img src={u.file_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-white truncate">{u.file_name || "file"}</p>
                    <p className="text-[10px] text-slate-500 truncate"><span className="font-bold text-slate-300">{u.clients?.name || "—"}</span> · #{hubSeq[u.id]} of {hubClientTotals[u.clients?.name || "Unknown"] || 0} · <span className="capitalize text-[var(--yellow)]">{u.content_type}</span></p>
                    <p className="text-[9px] text-slate-600">by {u.profiles?.name || "—"} · {new Date(u.created_at).toLocaleDateString()}</p>
                    {u.qc_status === "mismatch" && (
                      <p title={`${u.qc_detected_brand ? `Looks like: ${u.qc_detected_brand}. ` : ""}${u.qc_note || ""}`} className="text-[9px] font-bold text-rose-400 cursor-help">
                        ⚠ Brand mismatch{u.qc_detected_brand ? ` — looks like ${u.qc_detected_brand}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => applyHubUpload(u)} className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold cursor-pointer">
                  {selectedUpload?.id === u.id ? `Loaded #${hubSeq[u.id]} ✓` : `Use #${hubSeq[u.id]} →`}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer + live social preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
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
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Platforms <span className="text-slate-600 normal-case font-medium">— all pre-selected, click to unselect the ones you don&apos;t want</span></label>
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

        {/* Pick a thumbnail frame from the video — click a frame in the strip */}
        {mediaIsVideo && mediaUrl && (
          <div className="border border-slate-900 rounded-xl p-4 space-y-3 bg-slate-950/40">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <span>Pick thumbnail from video <span className="text-slate-600 normal-case font-medium">— click the frame you want</span></span>
                {videoDims && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 normal-case">
                    {videoDims.h > videoDims.w ? `Story/Reel ${videoDims.w}×${videoDims.h}` : `Landscape ${videoDims.w}×${videoDims.h}`}
                  </span>
                )}
              </label>
              {framesBusy && (
                <span className="text-[10px] text-slate-500 flex items-center space-x-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /><span>Reading frames… {frames.length}/8</span>
                </span>
              )}
            </div>
            {frames.length === 0 && !framesBusy ? (
              <p className="text-[11px] text-slate-600">No frames could be read from this video — upload a thumbnail file manually instead.</p>
            ) : (
              <div className={`grid gap-2 ${videoDims && videoDims.h > videoDims.w ? "grid-cols-4 sm:grid-cols-6 lg:grid-cols-8" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8"}`}>
                {frames.map((f) => (
                  <button
                    key={f.t}
                    type="button"
                    onClick={() => chooseFrame(f.t)}
                    disabled={uploading === "thumb"}
                    title={`Use frame at ${Math.round(f.t)}s`}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer disabled:opacity-60 ${
                      selFrame === f.t ? "border-[var(--yellow)] shadow-lg" : "border-slate-800 hover:border-indigo-500"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={`frame ${Math.round(f.t)}s`}
                      className="w-full object-cover"
                      style={{ aspectRatio: videoDims ? `${videoDims.w} / ${videoDims.h}` : "16 / 9" }}
                    />
                    <span className="absolute bottom-0 right-0 text-[8px] font-bold bg-black/70 text-white px-1 rounded-tl">{Math.round(f.t)}s</span>
                    {selFrame === f.t && uploading === "thumb" && (
                      <span className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-white" /></span>
                    )}
                    {selFrame === f.t && uploading !== "thumb" && thumbUrl && (
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--yellow)] text-black text-[9px] font-black flex items-center justify-center">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {thumbUrl && <p className="text-[11px] text-emerald-400 font-bold">Thumbnail set ✓ — click another frame or upload a file to replace it.</p>}
          </div>
        )}

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
              <span>{sending ? "Sending…" : `Post via RecurPost (${platforms.length * contentTypes.length})`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Social preview panel — .pv keeps true white inside even in day view */}
      <div className="pv lg:sticky lg:top-4 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Eye className="w-4 h-4 text-[var(--yellow)]" /><span>Social preview</span></h3>
        {platforms.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <button key={p} onClick={() => setPreviewPlat(p)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border capitalize cursor-pointer ${previewPlat === p ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>{p}</button>
            ))}
          </div>
        )}
        {contentTypes.length > 1 && ["instagram", "facebook"].includes(previewPlat) && (
          <div className="flex gap-1.5">
            {contentTypes.map((t) => (
              <button key={t} onClick={() => setPreviewType(t)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border capitalize cursor-pointer ${previewType === t ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>{t}</button>
            ))}
          </div>
        )}
        {renderPreview()}
        <p className="text-[10px] text-slate-600">Approximate preview — final look can differ slightly per platform.</p>
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
