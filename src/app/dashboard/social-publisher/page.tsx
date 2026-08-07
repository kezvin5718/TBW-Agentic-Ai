"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Avatar from "../Avatar";
import { fmtIST, fmtISTDate, istToday, istWallClockToUtc, IST_TZ } from "@/lib/time";
import { Send, Loader2, UploadCloud, Sparkles, Image as ImageIcon, CheckCircle2, AlertTriangle, Settings, Clock, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, Play, Eye, RotateCcw, Trash2 } from "lucide-react";
import PlatformIcon, { postLabel, PLATFORM_LABEL } from "./PlatformIcon";
import { uploadDirect } from "@/lib/direct-upload";

interface ClientRow { id: string; name: string; logo?: string }
interface HubUpload {
  id: string; client_id: string; file_url: string; file_name: string | null;
  media_type: string; content_type: "post" | "reel" | "story" | "thumbnail"; status: string;
  thumbnail_url?: string | null;
  qc_status?: string; qc_detected_brand?: string | null; qc_note?: string | null;
  created_at: string; clients?: { name: string } | null;
  profiles?: { name: string; avatar_url?: string | null; designation?: string | null } | null;
}
interface PostRow {
  id: string; platform: string; content_type: string; title: string | null; caption: string | null;
  media_url: string; thumbnail_url: string | null; scheduled_for: string | null; status: string;
  webhook_response?: string | null;
  created_at: string; clients?: { name: string } | null;
  profiles?: { name: string; avatar_url?: string | null; designation?: string | null } | null;
}

const PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "pinterest", label: "Pinterest" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
];
const TYPES = ["post", "reel", "story"] as const;

/** Instagram and Facebook Stories carry no caption — the text is dropped. */
const storyHasNoCaption = (contentType: string) => contentType === "story";

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
  // Thumbnail chosen from the Content Hub's Thumbnail section (its own upload row).
  const [selectedThumb, setSelectedThumb] = useState<{ id: string; name: string } | null>(null);
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
    const d = scheduledDate || istToday();
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
  const [uploadPct, setUploadPct] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // RecurPost
  const [rpConfigured, setRpConfigured] = useState(false);
  const [rpAccounts, setRpAccounts] = useState<Array<{ id: string; name: string; platform: string }>>([]);
  const [rpMapping, setRpMapping] = useState<Record<string, { client_id: string; platform: string }>>({});
  const [rpBusy, setRpBusy] = useState(false);
  const [rpSearch, setRpSearch] = useState("");
  const [rpPlatFilter, setRpPlatFilter] = useState("all");

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

  // Frames are extracted SERVER-side with ffmpeg — the browser can't read many
  // videos (Drive-hosted, HEVC/.mov, or hosts without CORS headers).
  const extractFrames = useCallback(async (src: string) => {
    setFramesBusy(true);
    setFrames([]);
    setSelFrame(null);
    try {
      const res = await fetch("/api/social-publisher/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: src }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Frame extraction failed");
      if (data.width && data.height) setVideoDims({ w: data.width, h: data.height });
      setFrames((data.frames || []).map((f: { t: number; preview: string }) => ({ t: f.t, url: f.preview })));
    } catch (err: unknown) {
      setNotice({ ok: false, text: `${err instanceof Error ? err.message : "Frame extraction failed"} — you can still upload a thumbnail file manually.` });
    } finally {
      setFramesBusy(false);
    }
  }, []);

  useEffect(() => {
    if (mediaIsVideo && mediaUrl) extractFrames(mediaUrl);
    else { setFrames([]); setSelFrame(null); setVideoDims(null); }
  }, [mediaIsVideo, mediaUrl, extractFrames]);

  // Click a frame → fetch it full-resolution from the server → set as thumbnail.
  const chooseFrame = async (t: number) => {
    setSelFrame(t);
    setUploading("thumb");
    try {
      const res = await fetch("/api/social-publisher/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl, t, full: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not capture the frame.");
      const blob = await (await fetch(data.dataUrl)).blob();
      setUploading(null);
      await upload("thumb", new File([blob], `frame-thumb-${Date.now()}.jpg`, { type: "image/jpeg" }));
      setNotice({ ok: true, text: "Frame set as thumbnail ✅" });
    } catch (err: unknown) {
      setUploading(null);
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

  // Last number in a filename ("Irin_Reel_2.mp4" → 2). Designers and video editors
  // work separately, so the number is what ties a reel to its cover.
  const numOf = (name?: string | null): number | null => {
    if (!name) return null;
    const m = name.replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : null;
  };

  // Thumbnails uploaded in the Content Hub's own Thumbnail section.
  const hubThumbs = hubUploads.filter((u) => u.content_type === "thumbnail");
  const hubMedia = hubUploads.filter((u) => u.content_type !== "thumbnail");

  // Fill the composer from a Content Hub item: client, media and content type auto-select.
  const applyHubUpload = (u: HubUpload) => {
    setClientId(u.client_id);
    setMediaUrl(u.file_url);
    setMediaName(u.file_name || "Content Hub file");
    setMediaIsVideo(u.media_type === "video");
    setContentTypes([u.content_type]);
    setSelectedUpload({ id: u.id, name: u.file_name || "Content Hub file" });

    // Auto-suggest the designer's cover whose number matches this reel.
    const n = numOf(u.file_name);
    const match = n === null ? undefined : hubThumbs.find((t) => t.client_id === u.client_id && numOf(t.file_name) === n);
    let thumbNote = "";
    if (match) {
      setThumbUrl(match.file_url);
      setSelectedThumb({ id: match.id, name: match.file_name || "thumbnail" });
      thumbNote = `, thumbnail #${n} "${match.file_name}" matched`;
    } else if (u.thumbnail_url) {
      setThumbUrl(u.thumbnail_url);
      setSelectedThumb(null);
      thumbNote = ", thumbnail included";
    } else {
      setThumbUrl("");
      setSelectedThumb(null);
    }

    setNotice({ ok: true, text: `Loaded "${u.file_name}" for ${u.clients?.name || "client"} — type auto-set to ${u.content_type}${thumbNote}.` });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Pick a cover from the Thumbnail section.
  const applyHubThumb = (t: HubUpload) => {
    setThumbUrl(t.file_url);
    setSelFrame(null);
    setSelectedThumb({ id: t.id, name: t.file_name || "thumbnail" });
    setNotice({ ok: true, text: `Thumbnail set from Content Hub: "${t.file_name}".` });
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
      const { data } = await supabase.from("clients").select("id, name, logo_url").is("archived_at", null).order("name");
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

  // Which platforms this client actually has connected in RecurPost.
  const mappedPlatforms = clientId
    ? Array.from(new Set(Object.values(rpMapping).filter((m) => m?.client_id === clientId).map((m) => m.platform).filter(Boolean)))
    : [];

  // When the client changes, select exactly the platforms they're set up for —
  // avoids composing a post that can only fail.
  useEffect(() => {
    if (!clientId || rpAccounts.length === 0) return;
    // Everything the client is set up for is pre-ticked; the team unticks what
    // they don't want. Nothing is auto-removed on their behalf.
    setPlatforms(mappedPlatforms.length > 0 ? mappedPlatforms : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, rpAccounts.length, rpMapping]);

  const upload = async (kind: "media" | "thumb", file: File) => {
    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > 500) {
      setNotice({ ok: false, text: `File is ${sizeMb.toFixed(0)}MB — maximum is 500MB. Compress the video and try again.` });
      return;
    }
    setUploading(kind);
    setUploadPct(0);
    setNotice(null);
    try {
      // Straight to Supabase Storage — a reel routed through our own server
      // held the whole file in memory and killed the container mid-upload.
      const data = await uploadDirect(file, "social", setUploadPct);
      if (kind === "media") { setMediaUrl(data.url); setMediaName(data.fileName); setMediaIsVideo(data.mediaType === "video"); }
      else { setThumbUrl(data.url); setSelectedThumb(null); }
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally { setUploading(null); setUploadPct(0); }
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
        body: JSON.stringify({ clientId, platforms, contentTypes, title, caption, mediaUrl, mediaIsVideo, thumbnailUrl: thumbUrl || undefined, scheduledFor: composeSchedule(), uploadId: selectedUpload?.id, thumbUploadId: selectedThumb?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      const okCount = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      const failCount = (data.results || []).length - okCount;
      const skipNote = (data.skipped || []).length > 0 ? ` Skipped: ${(data.skipped as string[]).join(" ")}` : "";
      setNotice({
        ok: failCount === 0,
        text:
          (failCount === 0
            ? `Sent via RecurPost for ${okCount} post(s) ✅`
            : `${okCount} sent, ${failCount} failed. Do NOT press Send again — the ones that worked are already scheduled. Retry just the failed ones from the Library below.`) + skipNote,
      });
      if (failCount === 0) { setTitle(""); setCaption(""); setCaptionBrief(""); setMediaUrl(""); setMediaName(""); setThumbUrl(""); setScheduledDate(""); setScheduledTime(""); setSelectedUpload(null); setSelectedThumb(null); }
      await loadHistory();
      await loadHubUploads();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Send failed" });
    } finally { setSending(false); }
  };

  // Reels are a hard requirement on Meta — a still image tagged "Reel" always
  // fails there, and used to surface as a cryptic RecurPost 415. Catch it here.
  const reelNeedsVideo = contentTypes.includes("reel") && !!mediaUrl && !mediaIsVideo;
  // YouTube is video-only. Platforms come pre-ticked from the client's mapping,
  // so on a photo post YouTube would silently ride along and fail.
  const ytNeedsVideo = !!mediaUrl && !mediaIsVideo;
  const canSend = !!clientId && platforms.length > 0 && contentTypes.length > 0 && !!mediaUrl && !reelNeedsVideo && !sending;



  // Per-client sequence numbers. The number in the filename wins (that's what the
  // designer and the video editor agreed on); upload order is the fallback.
  const hubSeq: Record<string, number> = {};
  const hubClientTotals: Record<string, number> = {};
  {
    const byClient: Record<string, HubUpload[]> = {};
    hubMedia.forEach((u) => { (byClient[u.client_id] ||= []).push(u); });
    Object.values(byClient).forEach((list) => {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      list.forEach((u, i) => { hubSeq[u.id] = numOf(u.file_name) ?? i + 1; });
      const cname = list[0]?.clients?.name || "Unknown";
      hubClientTotals[cname] = list.length;
    });
  }
  const thumbSeq: Record<string, number> = {};
  {
    const byClient: Record<string, HubUpload[]> = {};
    hubThumbs.forEach((u) => { (byClient[u.client_id] ||= []).push(u); });
    Object.values(byClient).forEach((list) => {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      list.forEach((u, i) => { thumbSeq[u.id] = numOf(u.file_name) ?? i + 1; });
    });
  }
  // Covers for the client being composed for, in number order.
  const thumbsForClient = hubThumbs
    .filter((t) => !clientId || t.client_id === clientId)
    .sort((a, b) => (thumbSeq[a.id] || 0) - (thumbSeq[b.id] || 0));

  const hubSorted = [...hubMedia].sort((a, b) => {
    const ca = a.clients?.name || "", cb = b.clients?.name || "";
    return ca === cb ? (hubSeq[a.id] || 0) - (hubSeq[b.id] || 0) : ca.localeCompare(cb);
  });

  // --- Library (queue / history) ---------------------------------------------
  const [view, setView] = useState<"compose" | "library">("compose");
  const [libFilter, setLibFilter] = useState<"all" | "scheduled" | "posted" | "failed">("all");
  const [libClient, setLibClient] = useState("all");
  const [libSel, setLibSel] = useState<PostRow | null>(null);
  const [libBusy, setLibBusy] = useState<string | null>(null);
  const [libView, setLibView] = useState<"agenda" | "month" | "list">("agenda");
  // Which month cell is opened out — 40+ posts a day won't fit in a fixed box.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // Agenda shows a run of days starting here — stepped a week at a time.
  const [agendaStart, setAgendaStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const AGENDA_DAYS = 7;
  const [libMonth, setLibMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  // Bucket by the IST calendar day — the agency works in Kolkata time, so a
  // 11pm-IST post must never land on the previous day's square.
  // Which IST calendar day an instant falls on — the agency works in Kolkata
  // time, so an 11pm-IST post must not land on the previous day's square.
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST_TZ });
  // The grid's own squares are already plain calendar dates, not instants.
  const cellKey = (y: number, m: number, day: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const postDate = (p: PostRow) => new Date(p.scheduled_for || p.created_at);

  const isFuture = (p: PostRow) => !!p.scheduled_for && new Date(p.scheduled_for).getTime() > Date.now();
  const libRows = posts.filter((p) => {
    if (libClient !== "all" && (p.clients?.name || "") !== libClient) return false;
    if (libFilter === "failed") return p.status === "failed";
    if (libFilter === "scheduled") return p.status === "sent" && isFuture(p);
    if (libFilter === "posted") return p.status === "sent" && !isFuture(p);
    return true;
  });

  const retryPost = async (p: PostRow) => {
    setLibBusy(p.id);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id: p.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Retry failed");
      setNotice({ ok: true, text: "Re-sent to RecurPost ✅" });
      await loadHistory();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Retry failed" });
    } finally { setLibBusy(null); }
  };

  const deletePost = async (p: PostRow) => {
    const warn = isFuture(p)
      ? "Remove this from your library?\n\nNOTE: RecurPost has no cancel API — if it's still scheduled there, you must also delete it inside RecurPost or it will still go out."
      : "Remove this post from your library?";
    if (!window.confirm(warn)) return;
    setLibBusy(p.id);
    try {
      const res = await fetch("/api/social-publisher", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      if (libSel?.id === p.id) setLibSel(null);
      await loadHistory();
      setNotice({ ok: true, text: "Removed from library." });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    } finally { setLibBusy(null); }
  };

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

  const PvMedia = ({ className = "" }: { className?: string }) => {
    if (!mediaUrl) {
      return <div className={`w-full h-full flex items-center justify-center bg-slate-200 text-slate-500 text-xs ${className}`}>Upload media to preview</div>;
    }
    if (!mediaIsVideo) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={mediaUrl} alt="" className={`w-full h-full object-cover ${className}`} />;
    }
    // Drive won't stream raw bytes to <video> — use its own player for those.
    const driveId = mediaUrl.match(/googleusercontent\.com\/d\/([^=/?&]+)/)?.[1] || mediaUrl.match(/drive\.google\.com\/file\/d\/([^/?&]+)/)?.[1];
    if (driveId) {
      return <iframe src={`https://drive.google.com/file/d/${driveId}/preview`} allow="autoplay" className={`w-full h-full border-0 bg-black ${className}`} />;
    }
    return <video src={mediaUrl} poster={thumbUrl || undefined} playsInline controls className={`w-full h-full object-cover bg-black ${className}`} />;
  };

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
    <div className={`${view === "library" ? "max-w-7xl" : "max-w-4xl"} mx-auto space-y-6`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Send className="w-6 h-6 text-[var(--yellow)]" /><span>Social Publisher</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Pick the client, upload the creative, generate an on-brand caption, set the time — it posts through RecurPost to your connected accounts.</p>
        </div>
        <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
          <button onClick={() => setView("compose")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${view === "compose" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>Compose</button>
          <button onClick={() => setView("library")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${view === "library" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
            <Eye className="w-3.5 h-3.5" /><span>Library ({posts.length})</span>
          </button>
        </div>
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
            ) : (() => {
              const rowFor = (a: { id: string; name: string; platform: string }) => {
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
              };

              const q = rpSearch.trim().toLowerCase();
              const filtered = rpAccounts.filter((a) => {
                const m = rpMapping[a.id];
                const clientName = m?.client_id ? clients.find((c) => c.id === m.client_id)?.name || "" : "";
                const matchesQ = !q || a.name.toLowerCase().includes(q) || clientName.toLowerCase().includes(q);
                const plat = m?.platform || a.platform || "";
                const matchesP = rpPlatFilter === "all" || plat === rpPlatFilter;
                return matchesQ && matchesP;
              });
              const unmapped = filtered.filter((a) => !rpMapping[a.id]?.client_id);
              const mapped = filtered.filter((a) => rpMapping[a.id]?.client_id);
              const byClient: Record<string, typeof rpAccounts> = {};
              mapped.forEach((a) => {
                const cn = clients.find((c) => c.id === rpMapping[a.id].client_id)?.name || "Unknown client";
                (byClient[cn] ||= []).push(a);
              });
              const platOptions = Array.from(new Set(rpAccounts.map((a) => rpMapping[a.id]?.platform || a.platform || "").filter(Boolean))).sort();

              return (
                <>
                  {/* Search + platform filter */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      value={rpSearch}
                      onChange={(e) => setRpSearch(e.target.value)}
                      placeholder="🔍 Search account or client name…"
                      className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => setRpPlatFilter("all")} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border capitalize cursor-pointer ${rpPlatFilter === "all" ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>All</button>
                      {platOptions.map((p) => (
                        <button key={p} onClick={() => setRpPlatFilter(p)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border capitalize cursor-pointer ${rpPlatFilter === p ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>{p}</button>
                      ))}
                    </div>
                  </div>

                  {/* Needs mapping first — this is the to-do list */}
                  {unmapped.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-1">⚠ Needs mapping ({unmapped.length})</p>
                      {unmapped.map(rowFor)}
                    </div>
                  )}

                  {/* Mapped — grouped by client */}
                  {Object.keys(byClient).sort().map((cn) => (
                    <div key={cn} className="mt-2">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider mb-1">✓ {cn} ({byClient[cn].length})</p>
                      {byClient[cn].map(rowFor)}
                    </div>
                  ))}

                  {filtered.length === 0 && <p className="text-[11px] text-slate-600 py-3">No accounts match your search/filter.</p>}
                </>
              );
            })()}
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

      {view === "compose" && (<>
      {/* Received from Content Hub — what designers have delivered, per client */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <UploadCloud className="w-4 h-4 text-[var(--yellow)]" />
            <span>Received from Content Hub</span>
            {hubMedia.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-400">{hubMedia.length} waiting</span>}
            {hubThumbs.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400">{hubThumbs.length} thumbnails</span>}
          </h3>
          {hubMedia.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setHubFilter("all")} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer ${hubFilter === "all" ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>All</button>
              {Array.from(new Set(hubMedia.map((u) => u.clients?.name || "Unknown"))).sort().map((n) => (
                <button key={n} onClick={() => setHubFilter(n)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer ${hubFilter === n ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400"}`}>
                  {n} <span className="font-black">({hubClientTotals[n] || 0})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {hubMedia.length === 0 ? (
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
                    <p className="text-[9px] text-slate-600 flex items-center gap-1.5">
                      <Avatar name={u.profiles?.name} url={u.profiles?.avatar_url} size={14} rounded="rounded-full"
                        title={u.profiles?.designation ? `${u.profiles.name} · ${u.profiles.designation}` : u.profiles?.name || ""} />
                      <span className="truncate">by {u.profiles?.name || "—"} · {fmtISTDate(u.created_at)}</span>
                    </p>
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
            {reelNeedsVideo && (
              <p className="text-[10px] text-rose-400 font-bold mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" /> Reel needs an actual video — the media loaded is an image. Upload a video, or switch to Post/Story.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            Platforms <span className="text-slate-600 normal-case font-medium">— this client&apos;s connected platforms are pre-selected; click to unselect</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const mapped = !clientId || mappedPlatforms.length === 0 || mappedPlatforms.includes(p.key);
              // YouTube can't take an image, but that's a warning, not a lock —
              // the team decides what to send.
              const needsVideo = p.key === "youtube" && ytNeedsVideo;
              const available = mapped && !needsVideo;
              return (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  title={
                    needsVideo
                      ? "YouTube only accepts video — an image post will be rejected. You can still select it."
                      : mapped ? "" : `${clients.find((c) => c.id === clientId)?.name || "This client"} has no ${p.label} account connected in RecurPost — posting here will fail.`
                  }
                  className={`px-4 py-2 rounded-full text-xs font-bold border cursor-pointer transition-all ${
                    platforms.includes(p.key)
                      ? "bg-indigo-500 border-indigo-500 text-black"
                      : available
                      ? "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                      : "bg-slate-950 border-slate-900 text-slate-700 opacity-50"
                  }`}
                >
                  {p.label}{needsVideo ? " ⚠ needs video" : !available ? " ⚠" : ""}
                </button>
              );
            })}
          </div>
          {ytNeedsVideo && platforms.includes("youtube") && (
            <p className="mt-2 text-[10px] text-amber-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              YouTube is selected but this post is an image — YouTube will reject it. Sending anyway is fine; it will show as failed in the Library.
            </p>
          )}
          {clientId && rpAccounts.length > 0 && mappedPlatforms.length === 0 && (
            <div className="mt-2 bg-amber-950/20 border border-amber-900/50 rounded-xl p-2.5 text-[11px] text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <b>{clients.find((c) => c.id === clientId)?.name}</b> has no social accounts mapped in RecurPost — any post will fail.
                {myRole === "founder" ? " Map them in the RecurPost Accounts panel above." : " Ask a founder to map them in RecurPost Accounts."}
              </span>
            </div>
          )}
        </div>

        {/* 2. Media + thumbnail */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Media (image / video) *</label>
            <div onClick={() => mediaRef.current?.click()} className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer transition-colors">
              {uploading === "media" ? (
                <div className="space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--yellow)]" />
                  <div className="h-1 bg-slate-900 rounded-full overflow-hidden max-w-[180px] mx-auto">
                    <div className="h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${uploadPct}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-500">{uploadPct}% uploaded</p>
                </div>
              ) :
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

        {/* Thumbnails from Content Hub — the designer uploads covers in their own
            section, numbered to match the video editor's reels. */}
        {thumbsForClient.length > 0 && (
          <div className="border border-emerald-900/50 rounded-xl p-4 bg-emerald-950/10 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Thumbnails from Content Hub <span className="text-slate-500 normal-case font-medium">— click the number that matches this reel</span></span>
              </label>
              {selectedThumb && <span className="text-[10px] font-bold text-emerald-400 truncate max-w-[220px]">Using #{thumbSeq[selectedThumb.id]} · {selectedThumb.name}</span>}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {thumbsForClient.map((t) => {
                const isMatch = selectedUpload && numOf(t.file_name) !== null && numOf(t.file_name) === numOf(selectedUpload.name);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyHubThumb(t)}
                    title={`${t.file_name || "thumbnail"}${isMatch ? " — number matches the loaded media" : ""}`}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      selectedThumb?.id === t.id ? "border-[var(--yellow)] shadow-lg" : isMatch ? "border-emerald-500" : "border-slate-800 hover:border-emerald-500"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.file_url} alt={t.file_name || "thumbnail"} className="w-full object-cover" style={{ aspectRatio: "9 / 16" }} />
                    <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-emerald-500 text-black text-[9px] font-black flex items-center justify-center">{thumbSeq[t.id]}</span>
                    {selectedThumb?.id === t.id && (
                      <span className="absolute bottom-0 right-0 text-[9px] font-black bg-[var(--yellow)] text-black px-1 rounded-tl">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!clientId && <p className="text-[10px] text-slate-600">Select a client to narrow these down.</p>}
          </div>
        )}

        {/* Thumbnail picker — the video itself plays in the Social preview panel */}
        {mediaIsVideo && mediaUrl && (
          <div className="border border-slate-900 rounded-xl p-4 bg-slate-950/40">
            <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <span>Thumbnail <span className="text-slate-600 normal-case font-medium">— click a frame, or upload your own above</span></span>
                {videoDims && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 normal-case">
                    {videoDims.h > videoDims.w ? `Story/Reel ${videoDims.w}×${videoDims.h}` : `Landscape ${videoDims.w}×${videoDims.h}`}
                  </span>
                )}
              </label>
              {framesBusy && (
                <span className="text-[10px] text-slate-500 flex items-center space-x-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /><span>Reading frames…</span>
                </span>
              )}
            </div>
            {thumbUrl && (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl} alt="chosen thumbnail" className="h-16 rounded-lg border border-[var(--yellow)] object-cover" />
                <span className="text-[10px] text-emerald-400 font-bold">Current thumbnail ✓</span>
              </div>
            )}
            {frames.length === 0 && !framesBusy ? (
              <p className="text-[11px] text-slate-600">No frames could be read from this video — upload a thumbnail file manually instead.</p>
            ) : (
              <div className={`grid gap-2 ${videoDims && videoDims.h > videoDims.w ? "grid-cols-4 sm:grid-cols-6 lg:grid-cols-8" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"}`}>
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
            </div>
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
          {contentTypes.length > 0 && contentTypes.every(storyHasNoCaption) && caption.trim() && (
            <p className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Stories don&apos;t carry a caption — Instagram and Facebook drop this text. Add it onto the image, or also select Post/Reel.
            </p>
          )}
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
                  min={istToday()}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">🕐 Time (click to pick)</label>
                <input type="time" value={scheduledTime} onClick={openPicker} onChange={(e) => setScheduledTime(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
              <div className="self-end pb-1 text-[11px] text-slate-500">
                {composeSchedule()
                  ? <>Scheduled: <span className="signal">{fmtIST(istWallClockToUtc(composeSchedule()), { weekday: "short", year: undefined })} IST</span></>
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

      </>)}

      {/* ------------------------------- LIBRARY ------------------------------- */}
      {view === "library" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { k: "all", label: `All (${posts.length})` },
                { k: "scheduled", label: `⏰ Scheduled (${posts.filter((p) => p.status === "sent" && isFuture(p)).length})` },
                { k: "posted", label: `✓ Posted (${posts.filter((p) => p.status === "sent" && !isFuture(p)).length})` },
                { k: "failed", label: `⚠ Failed (${posts.filter((p) => p.status === "failed").length})` },
              ] as const).map((f) => (
                <button key={f.k} onClick={() => setLibFilter(f.k)} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border cursor-pointer ${libFilter === f.k ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>{f.label}</button>
              ))}
              <select value={libClient} onChange={(e) => setLibClient(e.target.value)} className="ml-auto text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                <option value="all">All clients</option>
                {Array.from(new Set(posts.map((p) => p.clients?.name).filter(Boolean))).sort().map((n) => <option key={n} value={n as string}>{n}</option>)}
              </select>
            </div>

            {/* View toggle + month navigation */}
            <div className="flex items-center gap-3 flex-wrap border-t border-slate-900 pt-3">
              <div className="flex bg-slate-950 border border-slate-900 rounded-lg p-0.5 text-[10px] font-bold uppercase">
                {(["agenda", "month", "list"] as const).map((v) => (
                  <button key={v} onClick={() => setLibView(v)} className={`px-3 py-1.5 rounded-md cursor-pointer ${libView === v ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>{v}</button>
                ))}
              </div>
              {libView === "agenda" && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setAgendaStart((d) => { const n = new Date(d); n.setDate(n.getDate() - AGENDA_DAYS); return n; })}
                    className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer">‹</button>
                  <span className="text-sm font-bold text-white min-w-[190px] text-center">
                    {fmtISTDate(agendaStart)} — {fmtISTDate(new Date(agendaStart.getTime() + (AGENDA_DAYS - 1) * 86400000))}
                  </span>
                  <button onClick={() => setAgendaStart((d) => { const n = new Date(d); n.setDate(n.getDate() + AGENDA_DAYS); return n; })}
                    className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer">›</button>
                  <button onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setAgendaStart(d); }}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">Today</button>
                </div>
              )}
              {libView === "month" && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setLibMonth(new Date(libMonth.getFullYear(), libMonth.getMonth() - 1, 1))} className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer">‹</button>
                  <span className="text-sm font-bold text-white min-w-[130px] text-center">{libMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}</span>
                  <button onClick={() => setLibMonth(new Date(libMonth.getFullYear(), libMonth.getMonth() + 1, 1))} className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer">›</button>
                  <button onClick={() => { const d = new Date(); setLibMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }} className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">Today</button>
                </div>
              )}
            </div>

            {/* ---- AGENDA: one column per date, cards stacked down it ---- */}
            {libView === "agenda" ? (() => {
              const byDay: Record<string, PostRow[]> = {};
              libRows.forEach((p) => { (byDay[dayKey(postDate(p))] ||= []).push(p); });
              const todayKey = dayKey(new Date());
              const days = Array.from({ length: AGENDA_DAYS }, (_, i) => {
                const d = new Date(agendaStart);
                d.setDate(d.getDate() + i);
                return d;
              });

              return (
                <div className="space-y-3">
                  {days.map((d) => {
                    const key = dayKey(d);
                    const items = (byDay[key] || []).sort((a, b) => postDate(a).getTime() - postDate(b).getTime());
                    const isToday = key === todayKey;
                    return (
                      <div key={key} className={`rounded-xl border ${isToday ? "border-[var(--yellow)]/60 bg-[var(--yellow)]/5" : "border-slate-900 bg-slate-950/50"}`}>
                        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-900/80">
                          <div className="flex items-baseline gap-2">
                            <span className={`text-sm font-black ${isToday ? "text-[var(--yellow)]" : "text-white"}`}>
                              {d.toLocaleDateString("en-IN", { timeZone: IST_TZ, day: "numeric", month: "short" })}
                            </span>
                            <span className="text-[11px] font-bold text-slate-500">
                              {d.toLocaleDateString("en-IN", { timeZone: IST_TZ, weekday: "long" })}
                            </span>
                            {isToday && <span className="text-[9px] font-black uppercase text-[var(--yellow)]">Today</span>}
                          </div>
                          <span className="text-[10px] font-mono font-bold text-slate-500">
                            {items.length === 0 ? "nothing" : `${items.length} post${items.length > 1 ? "s" : ""}`}
                          </span>
                        </div>

                        {items.length === 0 ? (
                          <p className="text-[11px] text-slate-700 px-3 py-3">No posts on this date.</p>
                        ) : (
                          <div className="p-2 space-y-2">
                            {items.map((p) => (
                              <div key={p.id} className="flex items-start gap-2.5 bg-slate-950/80 border border-slate-900 rounded-lg p-2.5">
                                <div className={`w-12 shrink-0 rounded-md overflow-hidden ${["reel", "story"].includes(p.content_type) ? "aspect-[9/16]" : "aspect-square"} bg-slate-900`}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.thumbnail_url || p.media_url} alt="" className="w-full h-full object-cover" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-black text-white">
                                      {postDate(p).toLocaleTimeString("en-IN", { timeZone: IST_TZ, hour: "numeric", minute: "2-digit" })}
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-300">{p.clients?.name || "—"}</span>
                                    <span className="text-[9px] uppercase font-bold text-slate-500">{p.platform} · {p.content_type}</span>
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                                      p.status === "failed" ? "bg-rose-950/40 border-rose-900 text-rose-400"
                                      : isFuture(p) ? "bg-amber-950/40 border-amber-900 text-amber-400"
                                      : "bg-emerald-950/40 border-emerald-900 text-emerald-400"}`}>
                                      {p.status === "failed" ? "failed" : isFuture(p) ? "scheduled" : "posted"}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">{p.caption || p.title || "(no caption)"}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => setLibSel(p)} title="Preview" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer"><Eye className="w-3.5 h-3.5" /></button>
                                  {p.status === "failed" && (
                                    <button disabled={libBusy === p.id} onClick={() => retryPost(p)} title="Retry" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" /></button>
                                  )}
                                  <button disabled={libBusy === p.id} onClick={() => deletePost(p)} title="Remove" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-400 hover:text-rose-400 cursor-pointer disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })() : libView === "month" ? (() => {
              const y = libMonth.getFullYear(), m = libMonth.getMonth();
              const lead = new Date(y, m, 1).getDay();
              const days = new Date(y, m + 1, 0).getDate();
              const byDay: Record<string, PostRow[]> = {};
              libRows.forEach((p) => { (byDay[dayKey(postDate(p))] ||= []).push(p); });
              const todayKey = dayKey(new Date());
              const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
              return (
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-7 gap-px bg-slate-900 border border-slate-900 rounded-xl overflow-hidden min-w-[720px]">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="bg-slate-950 py-2 text-center text-[10px] font-black text-slate-500 uppercase tracking-wider">{d}</div>
                    ))}
                    {cells.map((day, i) => {
                      if (day === null) return <div key={`b${i}`} className="bg-slate-950/40 min-h-[110px]" />;
                      const k = cellKey(y, m, day);
                      const dayPosts = (byDay[k] || []).sort((a, b) => postDate(a).getTime() - postDate(b).getTime());
                      return (
                        <div key={k} className={`bg-slate-950/70 min-h-[110px] p-1.5 space-y-1 ${expandedDay === k ? "max-h-[420px] overflow-y-auto" : ""} ${k === todayKey ? "ring-1 ring-inset ring-[var(--yellow)]" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[11px] font-bold ${k === todayKey ? "text-[var(--yellow)]" : "text-slate-400"}`}>{day}</span>
                            {dayPosts.length > 0 && <span className="text-[8px] font-black px-1 rounded bg-slate-900 text-slate-500">{dayPosts.length}</span>}
                          </div>
                          {/* Brand + platform only — the caption belongs in the
                              preview, not squeezed into a calendar cell. */}
                          {(expandedDay === k ? dayPosts : dayPosts.slice(0, 3)).map((p) => {
                            const sch = p.status === "sent" && isFuture(p);
                            return (
                              <button key={p.id} onClick={() => setLibSel(p)} title={`${p.clients?.name || ""} · ${postLabel(p.platform, p.content_type)} — click to read the caption`}
                                className={`w-full text-left rounded-md border p-1 flex items-center gap-1 cursor-pointer transition-all ${libSel?.id === p.id ? "border-indigo-500 bg-indigo-950/30" : "border-slate-800 bg-slate-950 hover:border-slate-600"}`}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === "failed" ? "bg-rose-500" : sch ? "bg-amber-400" : "bg-emerald-400"}`} />
                                <PlatformIcon platform={p.platform} size={11} />
                                <span className="min-w-0 leading-tight">
                                  <span className="block text-[8.5px] font-bold text-slate-200 truncate">{p.clients?.name || "—"}</span>
                                  <span className="block text-[7.5px] text-slate-500 truncate">
                                    {PLATFORM_LABEL[p.platform] || p.platform} {p.content_type}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                          {dayPosts.length > 3 && (
                            <button
                              onClick={() => setExpandedDay(expandedDay === k ? null : k)}
                              className="text-[8px] text-indigo-400 font-bold pl-1 hover:text-indigo-300 cursor-pointer"
                            >
                              {expandedDay === k ? "− show less" : `+${dayPosts.length - 3} more`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })() : libRows.length === 0 ? (
              <p className="text-xs text-slate-600 py-10 text-center">Nothing here yet.</p>
            ) : (
              <div className="space-y-2">
                {libRows.map((p) => {
                  const scheduled = p.status === "sent" && isFuture(p);
                  return (
                    <div key={p.id} onClick={() => setLibSel(p)} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition-all ${libSel?.id === p.id ? "border-indigo-500 bg-indigo-950/20" : "border-slate-900 bg-slate-950/60 hover:border-slate-700"}`}>
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shrink-0 flex items-center justify-center">
                        {p.thumbnail_url || !/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(p.media_url) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail_url || p.media_url} alt="" className="w-full h-full object-cover" />
                        ) : <span className="text-slate-500 text-lg">▶</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-white truncate">{p.clients?.name || "—"} <span className="text-slate-500 font-normal capitalize">· {p.platform} · {p.content_type}</span></p>
                        <p className="text-[10px] text-slate-500 truncate">{p.title || p.caption?.slice(0, 70) || "(no caption)"}</p>
                        <p className="text-[9px] text-slate-600">{p.scheduled_for ? `⏰ ${fmtIST(p.scheduled_for)} IST` : `${fmtIST(p.created_at)} IST`} · {p.profiles?.name || ""}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${p.status === "failed" ? "bg-rose-950/40 border-rose-900 text-rose-400" : scheduled ? "bg-amber-950/40 border-amber-900 text-amber-400" : "bg-emerald-950/40 border-emerald-900 text-emerald-400"}`}>
                          {p.status === "failed" ? "FAILED" : scheduled ? "SCHEDULED" : "POSTED"}
                        </span>
                        {p.status === "failed" && (
                          <button disabled={libBusy === p.id} onClick={() => retryPost(p)} title="Retry" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer disabled:opacity-50">
                            {libBusy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <button disabled={libBusy === p.id} onClick={() => deletePost(p)} title="Remove from library" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected post preview */}
          <div className="pv lg:sticky lg:top-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Eye className="w-4 h-4 text-[var(--yellow)]" /><span>Preview</span></h3>
            {!libSel ? (
              <p className="text-[11px] text-slate-600 bg-slate-950/40 border border-slate-900 rounded-2xl p-6 text-center">Click a post to preview how it looks.</p>
            ) : (
              <>
                <div className="bg-white rounded-2xl overflow-hidden shadow-xl text-slate-900">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-400 to-pink-500 flex items-center justify-center text-white font-black text-xs">{(libSel.clients?.name || "B")[0].toUpperCase()}</div>
                    <span className="text-xs font-bold">{libSel.clients?.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
                      <PlatformIcon platform={libSel.platform} size={11} />
                      {postLabel(libSel.platform, libSel.content_type)}
                    </span>
                  </div>
                  <div className={["reel", "story"].includes(libSel.content_type) ? "aspect-[9/16] bg-black" : "aspect-square bg-slate-100"}>
                    {/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(libSel.media_url) ? (
                      <video src={libSel.media_url} poster={libSel.thumbnail_url || undefined} controls className="w-full h-full object-contain" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={libSel.media_url} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="px-3 py-2 text-xs">
                    {libSel.title && <p className="font-bold mb-1">{libSel.title}</p>}
                    <p className="text-slate-700 whitespace-pre-wrap break-words">{libSel.caption || "(no caption)"}</p>
                    {storyHasNoCaption(libSel.content_type) && libSel.caption && (
                      <p className="mt-1.5 text-[10px] font-bold text-amber-600">
                        ⚠ Stories don&apos;t show a caption — this text was not published with it.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500">
                    {libSel.scheduled_for ? `⏰ ${fmtIST(libSel.scheduled_for)} IST` : `${fmtIST(libSel.created_at)} IST`}
                  </span>
                  {libSel.status === "failed" && (
                    <button disabled={libBusy === libSel.id} onClick={() => retryPost(libSel)} className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1">
                      {libBusy === libSel.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}<span>Retry</span>
                    </button>
                  )}
                  <button disabled={libBusy === libSel.id} onClick={() => deletePost(libSel)} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /><span>Remove</span>
                  </button>
                </div>
                {libSel.status === "failed" && (
                  <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-2.5 text-[10px] text-rose-300">
                    <b>Failure detail:</b>
                    <p className="mt-1 break-words font-mono">{libSel.webhook_response || "—"}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
