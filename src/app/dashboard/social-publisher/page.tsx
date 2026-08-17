"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Avatar from "../Avatar";
import { fmtIST, fmtISTDate, istToday, istWallClockToUtc, IST_TZ } from "@/lib/time";
import { Send, Loader2, UploadCloud, Sparkles, Image as ImageIcon, CheckCircle2, AlertTriangle, Settings, Clock, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, Play, Eye, RotateCcw, Trash2, Pencil, X, FolderOpen, Film, Plus, Layers, Wand2, Copy } from "lucide-react";
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
  media_is_video?: boolean | null;
  recurpost_post_id?: number | null;
  needs_recurpost_cleanup?: boolean | null;
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
  // The tray is the widest column. Once a creative is picked it has done its job
  // and is just squeezing the composer and preview, so it folds away.
  const [hubCollapsed, setHubCollapsed] = useState(false);
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
  // The preview is only worth anything if it shows the shape the platform will
  // actually publish. A hard-coded square told everyone a 3:4 was fine.
  const [mediaAspect, setMediaAspect] = useState<number | null>(null);
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

  // --- Manual scrubbing -------------------------------------------------------
  // The evenly-spaced strip lands wherever it lands, and on a moving shot every
  // one of those moments is motion-blurred. This lets the team hunt for a sharp
  // frame themselves, shown big enough that softness is actually visible.
  const [videoDuration, setVideoDuration] = useState(0);
  const [scrubT, setScrubT] = useState(0);
  const [scrubPreview, setScrubPreview] = useState("");
  const [scrubBusy, setScrubBusy] = useState(false);
  // Drive-hosted and HEVC files won't decode in the browser — that is the whole
  // reason frames went server-side. Those fall back to ffmpeg-rendered stills.
  const [videoPlayable, setVideoPlayable] = useState(true);
  const scrubRef = useRef<HTMLVideoElement>(null);

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(videoDuration || 0, t));
    setScrubT(clamped);
    const v = scrubRef.current;
    if (v && videoPlayable) { try { v.currentTime = clamped; } catch { /* not seekable yet */ } }
  };

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
      // ffprobe's duration is the one to trust — the <video> element reports
      // Infinity for some fragmented MP4s until it has buffered the whole file.
      if (data.duration) setVideoDuration(Number(data.duration) || 0);
      setFrames((data.frames || []).map((f: { t: number; preview: string }) => ({ t: f.t, url: f.preview })));
    } catch (err: unknown) {
      setNotice({ ok: false, text: `${err instanceof Error ? err.message : "Frame extraction failed"} — you can still upload a thumbnail file manually.` });
    } finally {
      setFramesBusy(false);
    }
  }, []);

  useEffect(() => {
    // A new video means the old scrub position, duration and playability verdict
    // are all meaningless — reset before probing.
    setScrubT(0);
    setScrubPreview("");
    setVideoDuration(0);
    setVideoPlayable(true);
    if (mediaIsVideo && mediaUrl) extractFrames(mediaUrl);
    else { setFrames([]); setSelFrame(null); setVideoDims(null); }
  }, [mediaIsVideo, mediaUrl, extractFrames]);

  // Fallback scrubbing: when the browser can't decode the video, ask ffmpeg for
  // the frame at this instant. Debounced, so dragging the slider costs one
  // request per pause rather than one per pixel.
  useEffect(() => {
    if (videoPlayable || !mediaIsVideo || !mediaUrl) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setScrubBusy(true);
      try {
        const res = await fetch("/api/social-publisher/frames", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaUrl, t: scrubT, preview: true }),
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.dataUrl) setScrubPreview(data.dataUrl);
      } catch { /* keep showing the last good frame */ }
      finally { if (!cancelled) setScrubBusy(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [scrubT, videoPlayable, mediaIsVideo, mediaUrl]);

  // YouTube is auto-selected from the client's platform mapping, so silently
  // keeping it ticked on an image post causes a predictable failure. Drop it
  // automatically when an image loads; the team can re-tick if they mean video.
  useEffect(() => {
    if (mediaUrl && !mediaIsVideo) {
      setPlatforms((prev) => prev.filter((p) => p !== "youtube"));
    }
  }, [mediaIsVideo, mediaUrl]);

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
      if (!res.ok) return;
      const fresh: PostRow[] = (await res.json()).posts || [];
      setPosts(fresh);
      // The open detail panel is a snapshot — re-point it at the reloaded row so
      // an edit's consequences (the RecurPost cleanup warning) actually show.
      setLibSel((sel) => (sel ? fresh.find((p) => p.id === sel.id) || null : null));
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

    // Fold the tray away so the composer and preview get the full width — this
    // is what makes the frame big enough to judge.
    setHubCollapsed(true);
    setNotice({ ok: true, text: `Loaded "${u.file_name}" for ${u.clients?.name || "client"} — type auto-set to ${u.content_type}${thumbNote}.` });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // --- Multi-Story batch ------------------------------------------------------
  // Stories are ephemeral, so clients get many a day. Sending them one at a time
  // through the composer meant re-picking client and platforms for every slot.
  // Meta-only by construction: no other platform has a Story.
  const STORY_MAX = 30;
  interface StorySlot {
    key: string;
    mediaUrl: string; mediaName: string; mediaIsVideo: boolean;
    uploadId?: string;
    date: string; time: string;
  }
  const newSlot = (): StorySlot => ({
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mediaUrl: "", mediaName: "", mediaIsVideo: false, date: istToday(), time: "",
  });

  // "many" = a different creative per slot. "one" = a single creative repeated
  // across every slot. Both collapse to the same list of {media, time} on send.
  const [storyMode, setStoryMode] = useState<"many" | "one">("many");
  const [storyClientId, setStoryClientId] = useState("");
  const [storyPlatforms, setStoryPlatforms] = useState<string[]>(["instagram", "facebook"]);
  const [storySlots, setStorySlots] = useState<StorySlot[]>(() => [newSlot(), newSlot(), newSlot()]);
  const [storyOne, setStoryOne] = useState<{ url: string; name: string; isVideo: boolean; uploadId?: string }>({ url: "", name: "", isVideo: false });
  const [storySending, setStorySending] = useState(false);
  const [storyUploadTarget, setStoryUploadTarget] = useState<string | null>(null);
  const storyFileRef = useRef<HTMLInputElement>(null);
  // Spread helper — start time plus a fixed gap is how the team actually plans
  // a story day ("first at 9, then every 45 minutes").
  const [spreadDate, setSpreadDate] = useState(istToday());
  const [spreadStart, setSpreadStart] = useState("09:00");
  const [spreadGap, setSpreadGap] = useState(45);

  const patchSlot = (key: string, patch: Partial<StorySlot>) =>
    setStorySlots((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addSlot = () => setStorySlots((rows) => (rows.length >= STORY_MAX ? rows : [...rows, newSlot()]));
  const removeSlot = (key: string) =>
    setStorySlots((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));

  /** Fill every slot's date+time from a start point and a fixed gap, rolling
   *  past midnight onto the following day rather than wrapping to 00:xx. */
  const spreadEvenly = () => {
    const [h, m] = (spreadStart || "09:00").split(":").map(Number);
    const base = new Date(`${spreadDate}T00:00:00`);
    base.setHours(h || 0, m || 0, 0, 0);
    setStorySlots((rows) =>
      rows.map((r, i) => {
        const at = new Date(base.getTime() + i * Math.max(1, spreadGap) * 60000);
        return {
          ...r,
          date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
          time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
        };
      })
    );
  };

  /** Copy one slot's creative into every slot — the shortcut for "same story,
   *  many times" when you'd rather stay in the per-slot table. */
  const fillAllFrom = (src: StorySlot) =>
    setStorySlots((rows) =>
      rows.map((r) => ({ ...r, mediaUrl: src.mediaUrl, mediaName: src.mediaName, mediaIsVideo: src.mediaIsVideo, uploadId: undefined }))
    );

  /** Clone a slot in place, so re-posting the same story later doesn't mean
   *  hunting for the creative again. The copy is pushed one gap later on the
   *  clock: an exact same-creative-same-minute twin is treated as a duplicate
   *  on send and silently skipped, which looks like the button did nothing. */
  const duplicateSlot = (key: string) =>
    setStorySlots((rows) => {
      if (rows.length >= STORY_MAX) return rows;
      const i = rows.findIndex((r) => r.key === key);
      if (i < 0) return rows;
      const src = rows[i];
      let { date, time } = src;
      if (src.date && src.time) {
        const [hh, mm] = src.time.split(":").map(Number);
        const at = new Date(`${src.date}T00:00:00`);
        at.setHours(hh || 0, (mm || 0) + Math.max(1, spreadGap), 0, 0);
        date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
        time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      }
      const copy: StorySlot = { ...src, key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, date, time };
      return [...rows.slice(0, i + 1), copy, ...rows.slice(i + 1)];
    });

  // Uploading the day's stories one dropdown at a time was the slow part —
  // designers hand over a folder, so take the whole folder at once.
  const [storyBatch, setStoryBatch] = useState<{ done: number; total: number } | null>(null);
  const storyBatchRef = useRef<HTMLInputElement>(null);

  /** Upload many files at once, filling empty slots first, then appending. */
  const uploadStoryBatch = async (files: File[]) => {
    const list = files.slice(0, STORY_MAX);
    if (list.length === 0) return;
    setNotice(null);
    setStoryBatch({ done: 0, total: list.length });
    const done: Array<{ url: string; name: string; isVideo: boolean }> = [];
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      try {
        const data = await uploadDirect(list[i], "social", setUploadPct);
        done.push({ url: data.url, name: data.fileName, isVideo: data.mediaType === "video" });
      } catch {
        failed.push(list[i].name);
      }
      setStoryBatch({ done: i + 1, total: list.length });
    }
    setStoryBatch(null);
    setUploadPct(0);

    if (done.length > 0) {
      setStorySlots((rows) => {
        const next = [...rows];
        for (const u of done) {
          const empty = next.findIndex((r) => !r.mediaUrl);
          const filled = { mediaUrl: u.url, mediaName: u.name, mediaIsVideo: u.isVideo, uploadId: undefined };
          if (empty >= 0) next[empty] = { ...next[empty], ...filled };
          else if (next.length < STORY_MAX) next.push({ ...newSlot(), ...filled });
        }
        return next;
      });
    }
    setNotice({
      ok: failed.length === 0,
      text: failed.length === 0
        ? `${done.length} file(s) uploaded into story slots. Set the times, or use "Fill all times automatically".`
        : `${done.length} uploaded, ${failed.length} failed: ${failed.join(", ")}`,
    });
  };

  // Content Hub items this client has waiting, as the per-slot dropdown options.
  const storyHubOptions = hubUploads.filter(
    (u) => u.content_type !== "thumbnail" && (!storyClientId || u.client_id === storyClientId)
  );

  const storyPlatformsMapped = storyClientId
    ? Array.from(new Set(Object.values(rpMapping).filter((m) => m?.client_id === storyClientId).map((m) => m.platform)))
    : [];

  /** Upload a file straight to Storage and drop it into whichever slot asked. */
  const uploadForStory = async (target: string, file: File) => {
    setUploading("media");
    setUploadPct(0);
    try {
      const data = await uploadDirect(file, "social", setUploadPct);
      if (target === "one") setStoryOne({ url: data.url, name: data.fileName, isVideo: data.mediaType === "video" });
      else patchSlot(target, { mediaUrl: data.url, mediaName: data.fileName, mediaIsVideo: data.mediaType === "video", uploadId: undefined });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally { setUploading(null); setUploadPct(0); }
  };

  // Slots that are actually sendable — a creative and a time. Incomplete rows
  // are ignored rather than blocking the whole batch.
  const storyReady = storySlots.filter(
    (r) => r.date && r.time && (storyMode === "one" ? !!storyOne.url : !!r.mediaUrl)
  );
  const storyCanSend =
    !!storyClientId && storyPlatforms.length > 0 && storyReady.length > 0 && !storySending;

  const sendStories = async () => {
    setStorySending(true);
    setNotice(null);
    try {
      const items = storyReady.map((r) => ({
        mediaUrl: storyMode === "one" ? storyOne.url : r.mediaUrl,
        mediaIsVideo: storyMode === "one" ? storyOne.isVideo : r.mediaIsVideo,
        scheduledFor: `${r.date}T${r.time}`,
        uploadId: storyMode === "one" ? storyOne.uploadId : r.uploadId,
      }));
      const res = await fetch("/api/social-publisher/bulk-stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: storyClientId, platforms: storyPlatforms, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not schedule the stories");
      const skipNote = (data.skipped || []).length > 0 ? ` Skipped: ${(data.skipped as string[]).join(" ")}` : "";
      setNotice({
        ok: data.failed === 0,
        text:
          (data.failed === 0
            ? `${data.sent} story post(s) scheduled ✅`
            : `${data.sent} scheduled, ${data.failed} failed. Do NOT send again — the ones that worked are already queued. Retry the failed ones from the Library.`) + skipNote,
      });
      if (data.failed === 0) {
        setStorySlots([newSlot(), newSlot(), newSlot()]);
        setStoryOne({ url: "", name: "", isVideo: false });
      }
      await loadHistory();
      await loadHubUploads();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not schedule the stories" });
    } finally { setStorySending(false); }
  };

  /** Drop the loaded creative entirely and go back to an empty composer. */
  const clearSelection = () => {
    setSelectedUpload(null);
    setSelectedThumb(null);
    setMediaUrl("");
    setMediaName("");
    setMediaIsVideo(false);
    setThumbUrl("");
    setMediaAspect(null);
    setFrames([]);
    setSelFrame(null);
    setVideoDims(null);
    setNotice(null);
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
      if (kind === "media") { setMediaUrl(data.url); setMediaName(data.fileName); setMediaIsVideo(data.mediaType === "video"); setMediaAspect(null); }
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
        body: JSON.stringify({
          clientId, platform: platforms[0], contentType: contentTypes[0], brief: captionBrief, model: aiModel,
          mediaUrl: mediaUrl || undefined, mediaIsVideo, thumbnailUrl: thumbUrl || undefined,
        }),
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
  const [view, setView] = useState<"compose" | "library" | "stories" | "automation">("compose");

  // --- Automation -------------------------------------------------------------
  // Everything approved for a client, dated down the list in one move, captions
  // already written. The team's job here is to look and press send.
  interface AutoRow {
    id: string; file_url: string; file_name: string | null;
    media_type: string; content_type: string;
    caption: string | null; caption_status: string;
    thumbnail_url: string | null; created_at: string;
  }
  type Cadence = "daily" | "alternate" | "manual";

  const [autoClient, setAutoClient] = useState("");
  const [autoRows, setAutoRows] = useState<AutoRow[]>([]);
  const [autoPlatforms, setAutoPlatforms] = useState<string[]>([]);
  const [autoAvailable, setAutoAvailable] = useState<string[]>([]);
  const [autoRejected, setAutoRejected] = useState(0);
  const [autoAwaiting, setAutoAwaiting] = useState(0);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoSending, setAutoSending] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [autoStart, setAutoStart] = useState(istToday());
  const [autoTime, setAutoTime] = useState("19:30");
  // Per-row overrides. A row keeps its own date once touched, even when the
  // cadence is re-applied — that is the whole point of being able to change one.
  const [autoDates, setAutoDates] = useState<Record<string, string>>({});
  // Per-row times. Several videos can share a day at hours the team chooses,
  // rather than being forced onto one time plus automatic spacing.
  const [autoTimes, setAutoTimes] = useState<Record<string, string>>({});
  // Gap between posts that land on the same day. Null means nobody is spaced
  // automatically and the times on the rows are the only source.
  const [gapMins, setGapMins] = useState<number | null>(5);
  // Explicit running order. The list arrives in upload order, but that is rarely
  // the order it should go out in — two reels then three stills is a lump, not a
  // grid — so the sequence is the team's to arrange, and the dates follow it.
  const [autoOrder, setAutoOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);

  /** Move one row to sit where another currently is, keeping the rest in order. */
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setAutoOrder((prev) => {
      const next = prev.filter((x) => x !== fromId);
      const at = next.indexOf(toId);
      if (at < 0) return prev;
      next.splice(at, 0, fromId);
      return next;
    });
  };

  /** Fill in the captions that are missing, including ones that failed before. */
  const fillCaptions = async () => {
    setCaptionBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher/automation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: autoClient, action: "captions" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not write the captions");
      setNotice({
        ok: (data.failed || 0) === 0,
        text: data.message + (data.remaining > 0 ? ` ${data.remaining} still without one — run it again.` : ""),
      });
      await loadAutomation(autoClient);
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not write the captions" });
    } finally { setCaptionBusy(false); }
  };
  const [autoCaptions, setAutoCaptions] = useState<Record<string, string>>({});
  const [autoSkip, setAutoSkip] = useState<Set<string>>(new Set());

  const loadAutomation = useCallback(async (clientId: string) => {
    if (!clientId) { setAutoRows([]); return; }
    setAutoLoading(true);
    try {
      const res = await fetch(`/api/social-publisher/automation?clientId=${clientId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load");
      const rows = (data.uploads || []) as AutoRow[];
      setAutoRows(rows);
      setAutoAvailable(data.platforms || []);
      setAutoPlatforms(data.platforms || []);
      setAutoRejected(data.rejected || 0);
      setAutoAwaiting(data.awaitingCaption || 0);
      setAutoCaptions(Object.fromEntries(rows.map((r) => [r.id, r.caption || ""])));
      setAutoOrder(rows.map((r) => r.id));
      setAutoDates({});
      setAutoTimes({});
      setAutoSkip(new Set());
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not load" });
    } finally { setAutoLoading(false); }
  }, []);

  useEffect(() => { if (view === "automation" && autoClient) loadAutomation(autoClient); }, [view, autoClient, loadAutomation]);

  /** Step in days between consecutive posts for the chosen cadence. */
  const cadenceStep = cadence === "alternate" ? 2 : 1;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /** Base time plus n·5 minutes, never spilling past midnight onto another day. */
  const timePlus = (hhmm: string, mins: number): { time: string; clamped: boolean } => {
    const [h, m] = hhmm.split(":").map(Number);
    const total = (h || 0) * 60 + (m || 0) + mins;
    if (total >= 24 * 60) return { time: "23:59", clamped: true };
    return { time: `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`, clamped: false };
  };

  interface Slot { date: string; time: string; nthOfDay: number; outOfOrder: boolean; clamped: boolean; manualTime: boolean; collides: boolean }

  /**
   * The whole schedule, worked out in one pass.
   *
   * Dates are a chain rather than start + index·step: each post follows the one
   * before it, and a date set by hand becomes the new anchor that the rest
   * continue from. That is what makes moving one post pull the others with it —
   * dropping post 2 onto the 17th turns post 3 from the 19th into the 18th.
   *
   * A skipped row leaves the chain entirely rather than holding its slot open,
   * so removing a post closes the gap instead of leaving a blank day.
   *
   * Two posts on one date cannot fire at the same instant, so each one after the
   * first moves five minutes later.
   */
  const orderedRows = useMemo(() => {
    if (autoOrder.length === 0) return autoRows;
    const byId = new Map(autoRows.map((r) => [r.id, r]));
    const known = autoOrder.map((id) => byId.get(id)).filter(Boolean) as AutoRow[];
    // Anything that arrived after the order was set still has to appear.
    const extras = autoRows.filter((r) => !autoOrder.includes(r.id));
    return [...known, ...extras];
  }, [autoRows, autoOrder]);

  const schedule = useMemo(() => {
    const out: Record<string, Slot> = {};
    const usedPerDay: Record<string, number> = {};
    let prev: Date | null = null;

    for (const r of orderedRows) {
      if (autoSkip.has(r.id)) continue;

      let date = "";
      if (autoDates[r.id]) date = autoDates[r.id];
      // Manual is the "several videos in one day" mode: everything lands on the
      // chosen date and the gap spreads the times across it. It used to leave
      // every date blank, so nothing was sendable until each row was typed out
      // by hand — which is the work this screen exists to remove.
      else if (cadence === "manual") date = autoStart;
      else if (!prev) date = autoStart;
      else {
        const d = new Date(prev);
        d.setDate(d.getDate() + cadenceStep);
        date = ymd(d);
      }
      if (!date) continue;

      const asDate = new Date(`${date}T00:00:00`);
      // Moving a post before the one above it is allowed — sometimes you do
      // want it out earlier — but it is called out, because it usually is a slip.
      const outOfOrder = !!prev && asDate.getTime() < prev.getTime();

      const nth = usedPerDay[date] || 0;
      usedPerDay[date] = nth + 1;

      // A time set by hand is used as given. Automatic five-minute spacing is
      // there to stop two posts firing at once, not to overrule someone putting
      // eight videos out at the hours they actually want them at.
      const ownTime = autoTimes[r.id];
      const { time, clamped } = ownTime
        ? { time: ownTime, clamped: false }
        : timePlus(autoTime, gapMins === null ? 0 : nth * gapMins);
      // With spacing off and no time of its own, this shares an instant with the
      // post above it — worth saying, since both would fire together.
      const collides = !ownTime && gapMins === null && nth > 0;

      out[r.id] = { date, time, nthOfDay: nth, outOfOrder, clamped, manualTime: !!ownTime, collides };
      prev = asDate;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedRows, autoSkip, autoDates, autoTimes, autoStart, autoTime, cadence, cadenceStep, gapMins]);

  const autoReady = orderedRows.filter((r) => !!schedule[r.id]);
  const autoSameDay = Object.values(schedule).filter((s) => s.nthOfDay > 0).length;
  const autoOutOfOrder = Object.values(schedule).filter((s) => s.outOfOrder).length;
  const autoCollisions = Object.values(schedule).filter((s) => s.collides).length;
  const gapLabel = gapMins === null ? "set by hand"
    : gapMins >= 60 ? `${gapMins / 60}h` : `${gapMins}m`;

  const sendAutomation = async () => {
    setAutoSending(true);
    setNotice(null);
    try {
      // The per-row time matters here, not the base one: two posts sharing a day
      // are five minutes apart and must be sent that way.
      const items = orderedRows
        .filter((r) => !!schedule[r.id])
        .map((r) => ({
          uploadId: r.id,
          caption: autoCaptions[r.id] ?? r.caption ?? "",
          scheduledFor: `${schedule[r.id].date}T${schedule[r.id].time}`,
        }));

      const res = await fetch("/api/social-publisher/automation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: autoClient, platforms: autoPlatforms, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not schedule");
      const skipNote = (data.skipped || []).length ? ` Skipped: ${(data.skipped as string[]).join(" ")}` : "";
      setNotice({
        ok: data.failed === 0,
        text: (data.failed === 0
          ? `${data.scheduled} creative(s) scheduled — ${data.posts} post(s) queued. They're in the Library now.`
          : `${data.posts} queued, ${data.failed} failed. Do NOT send again — the ones that worked are already scheduled. Retry the failures from the Library.`) + skipNote,
      });
      await loadAutomation(autoClient);
      await loadHistory();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not schedule" });
    } finally { setAutoSending(false); }
  };
  const [libFilter, setLibFilter] = useState<"all" | "scheduled" | "posted" | "failed">("all");
  const [libClient, setLibClient] = useState("all");
  const [libSel, setLibSel] = useState<PostRow | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [editing, setEditing] = useState<{
    id: string; title: string; caption: string; mediaUrl: string;
    mediaIsVideo: boolean; thumbnailUrl: string; date: string; time: string;
  } | null>(null);
  const editMediaRef = useRef<HTMLInputElement>(null);
  const editThumbRef = useRef<HTMLInputElement>(null);
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
    if (libFilter === "scheduled") return ["sent", "published"].includes(p.status) && isFuture(p);
    if (libFilter === "posted") return ["sent", "published"].includes(p.status) && !isFuture(p);
    return true;
  });

  /** Ask RecurPost what the platforms actually did with our posts. */
  const verifyPublished = async () => {
    setVerifying(true);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check");
      const lines = (data.failures || []).map((f: { platform: string; contentType: string; reason: string }) =>
        `• ${postLabel(f.platform, f.contentType)} — ${f.reason || "no reason given"}`);
      setNotice({
        ok: (data.rejected || 0) === 0,
        text: [data.message, ...lines].join("\n"),
      });
      await loadHistory();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not check" });
    } finally { setVerifying(false); }
  };

  const retryPost = async (p: PostRow, confirmedRemoved = false) => {
    setLibBusy(p.id);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id: p.id, confirmedRemoved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Retry failed");
      setNotice({ ok: true, text: "Re-sent to RecurPost ✅" });
      setEditing(null);
      await loadHistory();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Retry failed" });
    } finally { setLibBusy(null); }
  };

  /** Open the editor on a Library post, seeded with what it currently holds. */
  const startEdit = (p: PostRow) => {
    const local = p.scheduled_for ? new Date(p.scheduled_for) : null;
    const pad = (n: number) => String(n).padStart(2, "0");
    const istParts = local
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(local).reduce<Record<string, string>>((a, x) => (a[x.type] = x.value, a), {})
      : null;
    setEditing({
      id: p.id,
      title: p.title || "",
      caption: p.caption || "",
      mediaUrl: p.media_url,
      mediaIsVideo: p.media_is_video ?? /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(p.media_url),
      thumbnailUrl: p.thumbnail_url || "",
      date: istParts ? `${istParts.year}-${istParts.month}-${istParts.day}` : "",
      // Intl with hour12:false reports midnight as "24" on some runtimes.
      time: istParts ? `${pad(Number(istParts.hour) % 24)}:${istParts.minute}` : "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setLibBusy(editing.id);
    setNotice(null);
    try {
      const res = await fetch("/api/social-publisher", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          title: editing.title,
          caption: editing.caption,
          mediaUrl: editing.mediaUrl,
          mediaIsVideo: editing.mediaIsVideo,
          thumbnailUrl: editing.thumbnailUrl,
          scheduledFor: editing.date && editing.time ? `${editing.date} ${editing.time}:00` : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setNotice({ ok: true, text: data.message });
      await loadHistory();
      // Stay open when RecurPost still holds the original — the next step
      // (delete there, then re-send) happens right here.
      if (!data.stillQueuedThere) setEditing(null);
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally { setLibBusy(null); }
  };

  /** Replace the media on a post being edited, straight to Storage. */
  const uploadForEdit = async (kind: "media" | "thumb", file: File) => {
    if (!editing) return;
    setUploading(kind);
    setUploadPct(0);
    setNotice(null);
    try {
      const data = await uploadDirect(file, "social", setUploadPct);
      setEditing((e) => e && (kind === "media"
        ? { ...e, mediaUrl: data.url, mediaIsVideo: data.mediaType === "video" }
        : { ...e, thumbnailUrl: data.url }));
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally { setUploading(null); setUploadPct(0); }
  };

  const deletePost = async (p: PostRow) => {
    if (!window.confirm("Remove this post from your library?")) return;
    setLibBusy(p.id);
    try {
      let res = await fetch("/api/social-publisher", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id }),
      });

      // Still queued at RecurPost. Deleting our row does not cancel it — their
      // API has no way to — so the flow stops here and walks through the real
      // cancellation, with the post id the Queue needs. The library row is only
      // removed after the user says that side is done, because the row holds
      // the id and deleting it first destroys the handle.
      if (res.status === 409) {
        const data = await res.json();
        const list = ((data.stillQueued || []) as Array<{ platform: string; contentType: string; recurpostPostId: number }>)
          .map((q) => `  • post ${q.recurpostPostId} (${postLabel(q.platform, q.contentType)})`)
          .join("\n");
        const go = window.confirm(
          `⚠️ RECURPOST WILL STILL PUBLISH THIS.\n\nDeleting it here does NOT cancel it — RecurPost's API has no cancel, so it must be deleted in their dashboard:\n\n1. Open social.recurpost.com → Queue\n2. Delete:\n${list}\n\nPress OK ONLY once you have deleted it there — the library row will then be removed.\nPress Cancel to keep the row (it holds the post id you need).`
        );
        if (!go) { setNotice({ ok: false, text: `Kept in the library. Delete post ${((data.stillQueued || [])[0]?.recurpostPostId) ?? ""} in RecurPost → Queue first, then remove it here.` }); return; }
        res = await fetch("/api/social-publisher", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id, confirmedRemoved: true }),
        });
      }

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
      return (
        <img
          src={mediaUrl}
          alt=""
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth && el.naturalHeight) setMediaAspect(el.naturalWidth / el.naturalHeight);
          }}
          className={`w-full h-full object-cover ${className}`}
        />
      );
    }
    // Drive won't stream raw bytes to <video> — use its own player for those.
    const driveId = mediaUrl.match(/googleusercontent\.com\/d\/([^=/?&]+)/)?.[1] || mediaUrl.match(/drive\.google\.com\/file\/d\/([^/?&]+)/)?.[1];
    if (driveId) {
      return <iframe src={`https://drive.google.com/file/d/${driveId}/preview`} allow="autoplay" className={`w-full h-full border-0 bg-black ${className}`} />;
    }
    return <video src={mediaUrl} poster={thumbUrl || undefined} playsInline controls className={`w-full h-full object-cover bg-black ${className}`} />;
  };

  /**
   * What the platform will actually show.
   *
   * Instagram's feed accepts between 1.91:1 and 4:5 and crops anything outside
   * that; Facebook is more permissive with portrait. Previewing everything as a
   * square (or, for Facebook, 16:9) hid real cropping — a 3:4 image looked fine
   * here and came out cut on the platform.
   */
  const feedAspect = (platform: string): { ratio: number; cropped: boolean } => {
    const natural = mediaAspect ?? 1;
    const min = platform === "instagram" ? 0.8 : 0.75; // 4:5 / 3:4
    const max = 1.91;
    const ratio = Math.min(max, Math.max(min, natural));
    return { ratio, cropped: mediaAspect !== null && Math.abs(ratio - natural) > 0.01 };
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
          <div className="bg-slate-100" style={{ aspectRatio: String(feedAspect("instagram").ratio) }}><PvMedia /></div>
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
          <div className="bg-slate-100" style={{ aspectRatio: String(feedAspect("facebook").ratio) }}><PvMedia /></div>
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
          <div className="bg-slate-100" style={{ aspectRatio: String(feedAspect("facebook").ratio) }}><PvMedia /></div>
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
    <div className={`${view === "library" ? "max-w-7xl" : view === "stories" || view === "automation" ? "max-w-5xl" : "max-w-[1700px]"} mx-auto space-y-6`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Send className="w-6 h-6 text-[var(--yellow)]" /><span>Social Publisher</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Pick the client, upload the creative, generate an on-brand caption, set the time — it posts through RecurPost to your connected accounts.</p>
        </div>
        <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
          <button onClick={() => setView("compose")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${view === "compose" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>Compose</button>
          <button onClick={() => setView("stories")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${view === "stories" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
            <Layers className="w-3.5 h-3.5" /><span>Multi-Story</span>
          </button>
          <button onClick={() => setView("automation")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${view === "automation" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
            <Wand2 className="w-3.5 h-3.5" /><span>Automation</span>
          </button>
          <button onClick={() => setView("library")} className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${view === "library" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
            <Eye className="w-3.5 h-3.5" /><span>Library ({posts.length})</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-center space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="whitespace-pre-wrap">{notice.text}</span>
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

      {view === "compose" && (
      <>
      {/* What is loaded, and the way back to the tray. Only shown once the tray
          is folded or something is selected — otherwise it is noise. */}
      {(hubCollapsed || selectedUpload || mediaUrl) && (
        <div className="flex items-center gap-2 flex-wrap bg-slate-950/40 border border-slate-900 rounded-xl px-3 py-2">
          {hubCollapsed && (
            <button onClick={() => setHubCollapsed(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer transition-all">
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Show Content Hub{hubMedia.length > 0 ? ` (${hubMedia.length} waiting)` : ""}</span>
            </button>
          )}
          {(selectedUpload || mediaUrl) && (
            <>
              <span className="text-[11px] text-slate-500 truncate">
                Loaded: <b className="text-white">{selectedUpload?.name || mediaName || "uploaded file"}</b>
                {selectedThumb && <span className="text-emerald-400"> · thumb {selectedThumb.name}</span>}
              </span>
              <button onClick={clearSelection}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-[11px] font-bold text-slate-400 hover:text-rose-400 cursor-pointer transition-all">
                <X className="w-3.5 h-3.5" /><span>Deselect</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Three columns: what the designers delivered, what you're composing, and
         how it will look — so picking a creative never scrolls the form away.
         With the tray folded it drops to two, and everything gets bigger. */}
      <div className={`grid grid-cols-1 gap-5 items-start ${hubCollapsed ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_330px]"}`}>
      {/* Received from Content Hub — what designers have delivered, per client */}
      {!hubCollapsed && (
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <UploadCloud className="w-4 h-4 text-[var(--yellow)]" />
            <span>Received from Content Hub</span>
            {hubMedia.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-400">{hubMedia.length} waiting</span>}
            {hubThumbs.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400">{hubThumbs.length} thumbnails</span>}
          </h3>
          <button onClick={() => setHubCollapsed(true)} title="Hide this panel — the composer and preview get the full width"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">
            <X className="w-3 h-3" /><span>Hide</span>
          </button>
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
          // Two across, not three: in a side column three cards squeeze the
          // filename down to "Irin …", and that number is what the team matches
          // a reel to its thumbnail by.
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      )}

      {/* Composer — the middle column */}
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
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Thumbnail (video posts only)</label>
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
            {/* RecurPost only applies a thumbnail to video posts — an image
                post has nothing for it to override. */}
            {thumbUrl && !mediaIsVideo && (
              <p className="mt-2 text-[10px] text-amber-400 leading-relaxed">
                This media is an image, not a video — RecurPost only applies a thumbnail to video posts (Reels/YouTube), so this won&apos;t be used.
              </p>
            )}
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
                <span>Thumbnail <span className="text-slate-600 normal-case font-medium">— scrub to any frame below, use a quick frame, or upload your own above</span></span>
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

            {/* Manual scrub. The strip only ever offers 10 fixed moments, and on
                a moving shot every one of them can be motion-blurred — so the
                frame is shown big enough here to actually judge sharpness. */}
            <div className="rounded-xl border border-slate-800 bg-black/50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-[var(--yellow)]" /><span>Scrub to the exact frame</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {scrubT.toFixed(2)}s{videoDuration > 0 ? ` / ${videoDuration.toFixed(2)}s` : ""}
                </span>
              </div>

              <div className="flex justify-center">
                <div
                  className="relative bg-black rounded-lg overflow-hidden border border-slate-800"
                  style={{ aspectRatio: videoDims ? `${videoDims.w} / ${videoDims.h}` : "16 / 9", height: 420, maxWidth: "100%" }}
                >
                  {videoPlayable ? (
                    <video
                      ref={scrubRef}
                      src={mediaUrl}
                      preload="metadata"
                      playsInline
                      muted
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) setVideoDuration(d);
                      }}
                      onError={() => setVideoPlayable(false)}
                      className="w-full h-full object-contain"
                    />
                  ) : scrubPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={scrubPreview} alt={`frame at ${scrubT.toFixed(2)}s`} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500 px-4 text-center">
                      {scrubBusy ? "Rendering frame…" : "Move the slider to load a frame"}
                    </div>
                  )}
                  {scrubBusy && (
                    <span className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    </span>
                  )}
                </div>
              </div>

              <input
                type="range" min={0} max={videoDuration || 0} step={0.05} value={scrubT}
                onChange={(e) => seekTo(Number(e.target.value))}
                disabled={!videoDuration}
                className="w-full accent-[var(--yellow)] cursor-pointer disabled:opacity-40"
              />

              {/* Nudging past a blurred moment is the whole point — a slider
                  alone can't reliably land on a single frame. */}
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                {[-1, -0.25, -0.05, 0.05, 0.25, 1].map((d) => (
                  <button key={d} type="button" onClick={() => seekTo(scrubT + d)} disabled={!videoDuration}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[10px] font-mono font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40">
                    {d > 0 ? `+${d}` : d}s
                  </button>
                ))}
              </div>

              <button type="button" onClick={() => chooseFrame(scrubT)} disabled={uploading === "thumb" || !videoDuration}
                className="w-full py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-[11px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                {uploading === "thumb" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                <span>{uploading === "thumb" ? "Capturing…" : `Use this frame (${scrubT.toFixed(2)}s)`}</span>
              </button>

              {!videoPlayable && (
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  This video can&apos;t be decoded by the browser (Drive-hosted, or a codec it doesn&apos;t support), so each frame is rendered on the server — expect a short pause after you move the slider.
                </p>
              )}
            </div>
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

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">📅 Date (click for calendar)</label>
                <input type="date" value={scheduledDate} onClick={openPicker} onChange={(e) => setScheduledDate(e.target.value)}
                  min={istToday()}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">🕐 Time (click to pick)</label>
                <input type="time" value={scheduledTime} onClick={openPicker} onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]" />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {composeSchedule()
                ? <>Scheduled: <span className="signal">{fmtIST(istWallClockToUtc(composeSchedule()), { weekday: "short", year: undefined })} IST</span></>
                : "Posts immediately"}
            </p>
            <button onClick={submit} disabled={!canSend} className={`w-full px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all ${canSend ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{sending ? "Sending…" : `Post via RecurPost (${platforms.length * contentTypes.length})`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Social preview panel — .pv keeps true white inside even in day view */}
      <div className="pv xl:sticky xl:top-4 space-y-3">
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
        {/* Cropping is the thing worth flagging: it is invisible until the post
            is live, and by then the jewellery has lost its top or bottom. */}
        {mediaAspect !== null && !mediaIsVideo && ["instagram", "facebook"].includes(previewPlat)
          && !["reel", "story"].includes(previewType) && feedAspect(previewPlat).cropped && (
          <p className="text-[10px] text-amber-400 leading-relaxed">
            This image is {mediaAspect < 1 ? `${(1 / mediaAspect).toFixed(2)}:1 tall` : `${mediaAspect.toFixed(2)}:1 wide`} —
            {previewPlat === "instagram" ? " Instagram crops feed posts to 4:5" : " Facebook crops this shape"}, so the edges above
            will be trimmed. Export at 4:5 (1080×1350) or 1:1 to keep all of it.
          </p>
        )}
        <p className="text-[10px] text-slate-600">Approximate preview — final look can differ slightly per platform.</p>
      </div>
      </div>
      </>
      )}

      {/* ------------------------------ AUTOMATION ----------------------------- */}
      {view === "automation" && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[var(--yellow)]" /><span>Automation</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Pick a client and everything approved for them appears here with its caption already written. Choose the rhythm, the dates fill themselves in, and one press sends the lot.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Client / Brand</label>
              <select value={autoClient} onChange={(e) => setAutoClient(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Platforms</label>
              <div className="flex flex-wrap gap-2">
                {autoAvailable.length === 0 ? (
                  <span className="text-[11px] text-slate-600 py-2">{autoClient ? "None mapped in RecurPost for this client." : "Select a client first."}</span>
                ) : autoAvailable.map((p) => (
                  <button key={p} onClick={() => setAutoPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                    className={`px-3.5 py-2 rounded-full text-xs font-bold border capitalize cursor-pointer transition-all ${autoPlatforms.includes(p) ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {autoRejected > 0 && (
            <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl p-2.5 text-[11px] text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span><b>{autoRejected}</b> creative(s) for this client were rejected at QC and are not shown here. Fix them in Content Hub and upload the set again.</span>
            </div>
          )}

          {/* Rhythm */}
          <div className="border border-slate-900 rounded-xl p-4 bg-slate-950/60 space-y-3">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Posting rhythm</label>
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 max-w-md">
              {([
                { k: "daily" as const, label: "Every day" },
                { k: "alternate" as const, label: "Alternate day" },
                { k: "manual" as const, label: "Same day" },
              ]).map((m) => (
                <button key={m.k} onClick={() => setCadence(m.k)}
                  className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${cadence === m.k ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              {(
                <div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">{cadence === "manual" ? "All posts on" : "First post on"}</span>
                  <input type="date" value={autoStart} min={istToday()} onClick={openPicker} onChange={(e) => setAutoStart(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
                </div>
              )}
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">{gapMins === null ? "Post all at" : "First post at"}</span>
                <input type="time" value={autoTime} onClick={openPicker} onChange={(e) => setAutoTime(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Gap between posts on the same day</span>
                <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex-wrap">
                  {([
                    { v: 5, label: "5m" },
                    { v: 10, label: "10m" },
                    { v: 30, label: "30m" },
                    { v: 60, label: "1h" },
                    { v: 120, label: "2h" },
                    { v: 180, label: "3h" },
                    { v: null, label: "Manual" },
                  ] as Array<{ v: number | null; label: string }>).map((g) => (
                    <button key={g.label} onClick={() => setGapMins(g.v)}
                      className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold cursor-pointer transition-all ${gapMins === g.v ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {(Object.keys(autoDates).length > 0 || Object.keys(autoTimes).length > 0) && (
                <button onClick={() => { setAutoDates({}); setAutoTimes({}); }}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-slate-400 hover:text-white cursor-pointer">
                  Reset {Object.keys(autoDates).length + Object.keys(autoTimes).length} change(s)
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-600">
              {cadence === "manual"
                ? `Every post goes out on the chosen date, spaced ${gapMins === null ? "only by the times you set" : gapLabel + " apart"} from the start time. Any row can still be given its own date or time.`
                : `Dates run ${cadence === "alternate" ? "every other day" : "one per day"}. Change any row and everything below it re-flows from there — move post 2 to the 17th and post 3 becomes the 18th.`}
            </p>
            {(autoSameDay > 0 || autoOutOfOrder > 0 || autoCollisions > 0) && (
              <div className="flex flex-wrap gap-3 text-[10px] pt-1">
                {autoSameDay > 0 && (
                  <span className="text-[var(--yellow)] font-bold">
                    {autoSameDay} post(s) share a day — {gapMins === null ? "spacing off, set each time yourself" : `spaced ${gapLabel} apart unless you set the time yourself`}
                  </span>
                )}
                {autoCollisions > 0 && (
                  <span className="text-rose-400 font-bold">
                    {autoCollisions} post(s) would fire at the same moment — give them a time or pick a gap
                  </span>
                )}
                {autoOutOfOrder > 0 && (
                  <span className="text-amber-400 font-bold">
                    {autoOutOfOrder} post(s) publish before the row above them
                  </span>
                )}
              </div>
            )}
          </div>

          {/* The list */}
          {autoLoading ? (
            <p className="text-xs text-slate-500 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading approved creatives…</p>
          ) : !autoClient ? (
            <p className="text-xs text-slate-600 py-8 text-center">Select a client to see what&apos;s waiting.</p>
          ) : autoRows.length === 0 ? (
            <p className="text-xs text-slate-600 py-8 text-center">Nothing approved and waiting for this client.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Approved &amp; waiting <span className="text-slate-600 normal-case font-medium">({autoReady.length} of {autoRows.length} selected)</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] text-slate-600">Drag a row by ⠿ to reorder — the dates follow the sequence.</span>
                  {autoAwaiting > 0 && (
                    <button onClick={fillCaptions} disabled={captionBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[11px] font-bold text-black cursor-pointer disabled:opacity-50">
                      {captionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      <span>{captionBusy ? "Writing…" : `Write ${autoAwaiting} missing caption(s)`}</span>
                    </button>
                  )}
                </div>
              </div>

              {orderedRows.map((r, i) => {
                const slot = schedule[r.id];
                const date = slot?.date || autoDates[r.id] || "";
                const skipped = autoSkip.has(r.id);
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== r.id) setOverId(r.id); }}
                    onDragLeave={() => setOverId((o) => (o === r.id ? null : o))}
                    onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, r.id); setDragId(null); setOverId(null); }}
                    className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
                      overId === r.id ? "border-[var(--yellow)] bg-[var(--yellow)]/5"
                      : dragId === r.id ? "border-indigo-600 opacity-40"
                      : skipped ? "border-slate-900 bg-slate-950/30 opacity-50"
                      : "border-slate-900 bg-slate-950/70"
                    }`}
                  >
                    <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                      <span className="w-6 h-6 rounded-full bg-[var(--yellow)] text-black text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                      <span className="text-slate-600 cursor-grab active:cursor-grabbing select-none leading-none" title="Drag to reorder — the dates follow the order">⠿</span>
                    </div>
                    <div className={`w-12 shrink-0 rounded-lg overflow-hidden border border-slate-800 bg-slate-900 ${["reel", "story"].includes(r.content_type) ? "aspect-[9/16]" : "aspect-square"}`}>
                      {r.media_type === "video"
                        ? <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">▶</div>
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={r.file_url} alt="" className="w-full h-full object-cover" />}
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-white truncate max-w-[220px]">{r.file_name || "creative"}</span>
                        <span className="text-[9px] uppercase font-bold text-slate-500">{r.content_type}</span>
                        {r.caption_status === "failed" && <span className="text-[9px] font-bold text-amber-400">caption failed — write one</span>}
                        {r.caption_status === "no_contact" && (
                          <span className="text-[9px] font-bold text-rose-400" title="Every caption must carry the address and phone">
                            no address/phone on file — add it in Brand Brain
                          </span>
                        )}
                      </div>
                      {r.content_type === "story" ? (
                        <p className="text-[10px] text-slate-600">Stories carry no caption — both platforms drop the text.</p>
                      ) : (
                        <textarea
                          value={autoCaptions[r.id] ?? ""}
                          onChange={(e) => setAutoCaptions((c) => ({ ...c, [r.id]: e.target.value }))}
                          rows={3}
                          placeholder="Caption is written automatically once QC passes…"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                        />
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <input type="date" value={date} onClick={openPicker}
                        onChange={(e) => setAutoDates((d) => ({ ...d, [r.id]: e.target.value }))}
                        className={`w-[136px] bg-slate-950 border rounded-lg px-2 py-1.5 text-[11px] text-white cursor-pointer [color-scheme:dark] focus:outline-none ${
                          slot?.outOfOrder ? "border-amber-600" : autoDates[r.id] ? "border-indigo-600" : "border-slate-800"
                        }`} />
                      {slot && (
                        <div className="flex items-center gap-1">
                          <input
                            type="time"
                            value={slot.time}
                            onClick={openPicker}
                            onChange={(e) => setAutoTimes((t) => ({ ...t, [r.id]: e.target.value }))}
                            title="Set this post's own time"
                            className={`w-[92px] bg-slate-950 border rounded-lg px-1.5 py-1 text-[11px] cursor-pointer [color-scheme:dark] focus:outline-none ${
                              slot.manualTime ? "border-indigo-600 text-white"
                              : slot.nthOfDay > 0 ? "border-slate-800 text-[var(--yellow)]"
                              : "border-slate-800 text-slate-400"
                            }`}
                          />
                          {slot.nthOfDay > 0 && !slot.manualTime && gapMins !== null && (
                            <span className="text-[9px] font-bold text-[var(--yellow)]" title="Spaced so two posts don't fire at once">+{slot.nthOfDay * gapMins >= 60 ? `${((slot.nthOfDay * gapMins) / 60).toFixed(1).replace(/\.0$/, "")}h` : `${slot.nthOfDay * gapMins}m`}</span>
                          )}
                        </div>
                      )}
                      {slot?.outOfOrder && (
                        <span className="text-[9px] font-bold text-amber-400" title="This posts before the one above it">⚠ out of order</span>
                      )}
                      {slot?.clamped && (
                        <span className="text-[9px] font-bold text-rose-400" title="The spacing would have crossed midnight">⚠ time capped</span>
                      )}
                      {slot?.collides && (
                        <span className="text-[9px] font-bold text-rose-400" title="Same instant as the post above — set a time or pick a gap">⚠ same time</span>
                      )}
                      {(autoDates[r.id] || autoTimes[r.id]) && (
                        <button
                          onClick={() => {
                            setAutoDates((d) => { const n = { ...d }; delete n[r.id]; return n; });
                            setAutoTimes((t) => { const n = { ...t }; delete n[r.id]; return n; });
                          }}
                          className="text-[9px] font-bold text-slate-600 hover:text-white cursor-pointer">reset</button>
                      )}
                      <button onClick={() => setAutoSkip((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                        className="text-[10px] font-bold text-slate-500 hover:text-white cursor-pointer">
                        {skipped ? "include" : "skip"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Send */}
          {autoRows.length > 0 && (
            <div className="border-t border-slate-900 pt-4 space-y-2">
              <p className="text-[11px] text-slate-500">
                {autoReady.length === 0
                  ? "Nothing selected — every row is skipped or has no date."
                  : <>Will schedule <span className="signal">{autoReady.length * autoPlatforms.length}</span> post(s) — {autoReady.length} creative(s) × {autoPlatforms.length} platform(s){autoSameDay > 0 ? `, with ${autoSameDay} spaced 5 minutes apart on a shared day` : `, all at ${autoTime}`}.</>}
              </p>
              <button onClick={sendAutomation} disabled={autoSending || autoReady.length === 0 || autoPlatforms.length === 0}
                className={`w-full px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all ${!autoSending && autoReady.length > 0 && autoPlatforms.length > 0 ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
                {autoSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{autoSending ? "Scheduling — this can take a minute…" : `Post via RecurPost (${autoReady.length * autoPlatforms.length})`}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------- MULTI-STORY ----------------------------- */}
      {view === "stories" && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--yellow)]" /><span>Multi-Story — schedule up to {STORY_MAX} Stories in one go</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Instagram and Facebook only — no other platform has Stories. Captions are left out on purpose: both platforms drop the text on a Story, so put any wording onto the creative itself.
            </p>
          </div>

          {/* Client + mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Client / Brand</label>
              <select value={storyClientId} onChange={(e) => setStoryClientId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Batch type</label>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
                <button onClick={() => setStoryMode("many")}
                  className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${storyMode === "many" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
                  Many creatives
                </button>
                <button onClick={() => setStoryMode("one")}
                  className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${storyMode === "one" ? "bg-indigo-500 text-black" : "text-slate-400 hover:text-white"}`}>
                  One creative, many times
                </button>
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5">
                {storyMode === "many"
                  ? "Each slot below carries its own creative and its own time."
                  : "Pick one creative, then give it as many times as you want."}
              </p>
            </div>
          </div>

          {/* Platforms — Meta only, by construction */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {["instagram", "facebook"].map((p) => {
                const mapped = !storyClientId || storyPlatformsMapped.length === 0 || storyPlatformsMapped.includes(p);
                return (
                  <button key={p} onClick={() => setStoryPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                    title={mapped ? "" : `${clients.find((c) => c.id === storyClientId)?.name || "This client"} has no ${p} account connected in RecurPost — posting here will fail.`}
                    className={`px-4 py-2 rounded-full text-xs font-bold border capitalize cursor-pointer transition-all ${
                      storyPlatforms.includes(p) ? "bg-indigo-500 border-indigo-500 text-black"
                      : mapped ? "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                      : "bg-slate-950 border-slate-900 text-slate-700 opacity-50"}`}>
                    {p}{!mapped ? " ⚠" : ""}
                  </button>
                );
              })}
            </div>
            {storyClientId && rpAccounts.length > 0 && storyPlatformsMapped.length === 0 && (
              <div className="mt-2 bg-amber-950/20 border border-amber-900/50 rounded-xl p-2.5 text-[11px] text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span><b>{clients.find((c) => c.id === storyClientId)?.name}</b> has no social accounts mapped in RecurPost — every slot will fail.</span>
              </div>
            )}
          </div>

          {/* One-creative mode: the single creative everything reuses */}
          {storyMode === "one" && (
            <div className="border border-emerald-900/50 rounded-xl p-4 bg-emerald-950/10 space-y-2">
              <label className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">The creative</label>
              <div className="flex items-center gap-3 flex-wrap">
                {storyOne.url && (
                  <div className="w-12 rounded-lg overflow-hidden border border-slate-800 bg-slate-900 shrink-0" style={{ aspectRatio: "9 / 16" }}>
                    {storyOne.isVideo
                      ? <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">▶</div>
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={storyOne.url} alt="" className="w-full h-full object-cover" />}
                  </div>
                )}
                <select
                  value={storyOne.url}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__upload__") { setStoryUploadTarget("one"); storyFileRef.current?.click(); return; }
                    const u = storyHubOptions.find((o) => o.file_url === v);
                    setStoryOne({ url: v, name: u?.file_name || "", isVideo: u?.media_type === "video", uploadId: u?.id });
                  }}
                  className="flex-1 min-w-[220px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                  <option value="">— pick a creative —</option>
                  {storyOne.url && !storyHubOptions.some((o) => o.file_url === storyOne.url) && (
                    <option value={storyOne.url}>{storyOne.name || "uploaded file"}</option>
                  )}
                  {storyHubOptions.map((u) => <option key={u.id} value={u.file_url}>{u.file_name || "file"}</option>)}
                </select>
                <button onClick={() => { setStoryUploadTarget("one"); storyFileRef.current?.click(); }} disabled={uploading === "media"}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-50 shrink-0">
                  <UploadCloud className="w-3.5 h-3.5" /><span>Upload</span>
                </button>
              </div>
              {storyOne.url && <p className="text-[10px] text-emerald-400 font-bold truncate">Using: {storyOne.name || "uploaded file"}</p>}
              {!storyClientId && <p className="text-[10px] text-slate-600">Select a client to see their Content Hub creatives.</p>}
            </div>
          )}

          {/* Upload straight in. Content Hub only covers what designers have
              already delivered — anything shot or exported today isn't there. */}
          {storyMode === "many" && (
            <div className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 bg-slate-950/60 transition-colors space-y-2">
              <div
                onClick={() => !storyBatch && storyBatchRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length > 0 && !storyBatch) uploadStoryBatch(files);
                }}
                className="text-center cursor-pointer"
              >
                {storyBatch ? (
                  <div className="space-y-2">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--yellow)]" />
                    <p className="text-[11px] font-bold text-white">Uploading {storyBatch.done} of {storyBatch.total}…</p>
                    <div className="h-1 bg-slate-900 rounded-full overflow-hidden max-w-[220px] mx-auto">
                      <div className="h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${uploadPct}%` }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="w-6 h-6 mx-auto mb-1.5 text-[var(--yellow)]" />
                    <p className="text-xs font-bold text-white">Upload story files — drop them here, or click to browse</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Pick many at once: each file fills the next empty slot, and new slots are added as needed (up to {STORY_MAX}).
                    </p>
                  </>
                )}
              </div>
              <input
                ref={storyBatchRef} type="file" multiple accept="image/*,video/mp4,video/quicktime" className="hidden"
                onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) uploadStoryBatch(f); e.target.value = ""; }}
              />
            </div>
          )}

          {/* Spread helper — how a story day is actually planned */}
          <div className="border border-slate-900 rounded-xl p-4 bg-slate-950/60 space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-[var(--yellow)]" /><span>Fill all times automatically</span>
            </label>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Start date</span>
                <input type="date" value={spreadDate} min={istToday()} onClick={openPicker} onChange={(e) => setSpreadDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">First story at</span>
                <input type="time" value={spreadStart} onClick={openPicker} onChange={(e) => setSpreadStart(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Gap (minutes)</span>
                <input type="number" min={1} value={spreadGap} onChange={(e) => setSpreadGap(Number(e.target.value) || 1)}
                  className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
              </div>
              <button onClick={spreadEvenly}
                className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer">
                Apply to all {storySlots.length} slots
              </button>
            </div>
            <p className="text-[10px] text-slate-600">Times run past midnight onto the next day rather than wrapping back to the morning.</p>
          </div>

          {/* The slots */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Story slots <span className="text-slate-600 normal-case font-medium">({storySlots.length} of {STORY_MAX} · {storyReady.length} ready to send)</span>
              </label>
              <div className="flex gap-2">
                <button onClick={addSlot} disabled={storySlots.length >= STORY_MAX}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5" /><span>Add slot</span>
                </button>
                <button onClick={() => setStorySlots((rows) => { const need = Math.min(STORY_MAX, 10) - rows.length; return need > 0 ? [...rows, ...Array.from({ length: need }, newSlot)] : rows; })}
                  disabled={storySlots.length >= 10}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[11px] font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40">
                  Make it 10
                </button>
              </div>
            </div>

            {storySlots.map((r, i) => (
              <div key={r.key} className="flex items-center gap-2 flex-wrap bg-slate-950/60 border border-slate-900 rounded-lg p-2">
                <span className="w-6 h-6 rounded-full bg-[var(--yellow)] text-black text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>

                {storyMode === "many" && (
                  <>
                    {r.mediaUrl && (
                      <div className="w-8 rounded overflow-hidden border border-slate-800 bg-slate-900 shrink-0" style={{ aspectRatio: "9 / 16" }}>
                        {r.mediaIsVideo
                          ? <div className="w-full h-full flex items-center justify-center text-slate-500 text-[10px]">▶</div>
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={r.mediaUrl} alt="" className="w-full h-full object-cover" />}
                      </div>
                    )}
                    <select
                      value={r.mediaUrl}
                      onChange={(e) => {
                        const v = e.target.value;
                        const u = storyHubOptions.find((o) => o.file_url === v);
                        patchSlot(r.key, { mediaUrl: v, mediaName: u?.file_name || "", mediaIsVideo: u?.media_type === "video", uploadId: u?.id });
                      }}
                      className="flex-1 min-w-[160px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                      <option value="">— pick from Content Hub —</option>
                      {r.mediaUrl && !storyHubOptions.some((o) => o.file_url === r.mediaUrl) && (
                        <option value={r.mediaUrl}>{r.mediaName || "uploaded file"}</option>
                      )}
                      {storyHubOptions.map((u) => <option key={u.id} value={u.file_url}>{u.file_name || "file"}</option>)}
                    </select>
                    <button onClick={() => { setStoryUploadTarget(r.key); storyFileRef.current?.click(); }}
                      disabled={uploading === "media" || !!storyBatch} title="Upload a file into this slot"
                      className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-slate-400 hover:text-white cursor-pointer disabled:opacity-40">
                      <UploadCloud className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                <input type="date" value={r.date} min={istToday()} onClick={openPicker} onChange={(e) => patchSlot(r.key, { date: e.target.value })}
                  className="w-[140px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
                <input type="time" value={r.time} onClick={openPicker} onChange={(e) => patchSlot(r.key, { time: e.target.value })}
                  className="w-[110px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />

                <button onClick={() => duplicateSlot(r.key)} disabled={storySlots.length >= STORY_MAX}
                  title={`Duplicate this slot — same creative, ${spreadGap} min later`}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-slate-400 hover:text-white cursor-pointer disabled:opacity-30">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {storyMode === "many" && r.mediaUrl && (
                  <button onClick={() => fillAllFrom(r)} title="Use this creative in every slot"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">
                    Fill all
                  </button>
                )}
                <button onClick={() => removeSlot(r.key)} disabled={storySlots.length <= 1} title="Remove this slot"
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-400 hover:text-rose-400 cursor-pointer disabled:opacity-30">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <input ref={storyFileRef} type="file" accept="image/*,video/mp4,video/quicktime" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && storyUploadTarget) uploadForStory(storyUploadTarget, f); e.target.value = ""; }} />

          {uploading === "media" && (
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--yellow)]" />
              <span>Uploading… {uploadPct}%</span>
            </div>
          )}

          {/* Send */}
          <div className="border-t border-slate-900 pt-4 space-y-2">
            <p className="text-[11px] text-slate-500">
              {storyReady.length === 0
                ? "Nothing ready yet — each slot needs a creative and a time. Incomplete slots are ignored."
                : <>Will schedule <span className="signal">{storyReady.length * storyPlatforms.length}</span> story post(s) — {storyReady.length} slot(s) × {storyPlatforms.length} platform(s).</>}
            </p>
            <button onClick={sendStories} disabled={!storyCanSend}
              className={`w-full px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all ${
                storyCanSend ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
              {storySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{storySending ? "Scheduling — this can take a minute…" : `Schedule ${storyReady.length * storyPlatforms.length} story post(s)`}</span>
            </button>
            {storySending && (
              <p className="text-[10px] text-amber-400 text-center">
                Each post is a separate RecurPost call — don&apos;t close this tab or press the button again.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------- LIBRARY ------------------------------- */}
      {view === "library" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { k: "all", label: `All (${posts.length})` },
                { k: "scheduled", label: `⏰ Scheduled (${posts.filter((p) => ["sent", "published"].includes(p.status) && isFuture(p)).length})` },
                { k: "posted", label: `✓ Posted (${posts.filter((p) => ["sent", "published"].includes(p.status) && !isFuture(p)).length})` },
                { k: "failed", label: `⚠ Failed (${posts.filter((p) => p.status === "failed").length})` },
              ] as const).map((f) => (
                <button key={f.k} onClick={() => setLibFilter(f.k)} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border cursor-pointer ${libFilter === f.k ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>{f.label}</button>
              ))}
              {/* "Sent" only ever meant RecurPost took it. This asks the
                  platforms what actually went live. */}
              <button onClick={verifyPublished} disabled={verifying}
                className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-indigo-500 cursor-pointer disabled:opacity-50">
                {verifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                <span>{verifying ? "Checking…" : "Check what actually published"}</span>
              </button>
              <select value={libClient} onChange={(e) => setLibClient(e.target.value)} className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
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
                                  {(p.status === "failed" || isFuture(p)) && (
                                    <button onClick={() => { setLibSel(p); startEdit(p); }} title="Edit caption, thumbnail or time" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                                  )}
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
                        {(p.status === "failed" || scheduled) && (
                          <button onClick={() => { setLibSel(p); startEdit(p); }} title="Edit caption, thumbnail or time" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
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
                  {/* Editing can only achieve something while nothing has gone
                      out yet — a published post lives on the platform now. */}
                  {(libSel.status === "failed" || isFuture(libSel)) && editing?.id !== libSel.id && (
                    <button onClick={() => startEdit(libSel)} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-600 text-[10px] font-bold cursor-pointer flex items-center gap-1">
                      <Pencil className="w-3 h-3" /><span>Edit</span>
                    </button>
                  )}
                  <button disabled={libBusy === libSel.id} onClick={() => deletePost(libSel)} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /><span>Remove</span>
                  </button>
                </div>

                {libSel.status === "sent" && !isFuture(libSel) && (
                  <p className="text-[10px] text-slate-600">
                    Already published — it can only be changed on the platform itself now.
                  </p>
                )}

                {/* Standing warning: our copy is corrected, RecurPost's isn't. */}
                {libSel.needs_recurpost_cleanup && (
                  <div className="bg-amber-950/25 border border-amber-900/60 rounded-xl p-3 space-y-2">
                    <p className="text-[11px] text-amber-200 font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> RecurPost still holds the old version
                    </p>
                    <p className="text-[10px] text-amber-200/80 leading-relaxed">
                      Your correction is saved here, but RecurPost gives us no way to change or cancel a queued post.
                      Open RecurPost → Queue, delete post{" "}
                      <b className="font-mono">{libSel.recurpost_post_id ?? "(id not recorded)"}</b>, then press Re-send —
                      otherwise both versions publish.
                    </p>
                    <button
                      disabled={libBusy === libSel.id}
                      onClick={() => {
                        if (!window.confirm(`Have you deleted post ${libSel.recurpost_post_id ?? ""} in RecurPost's Queue?\n\nIf it is still there, this will publish twice.`)) return;
                        retryPost(libSel, true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[10px] font-bold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      {libBusy === libSel.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      <span>I&apos;ve deleted it — re-send corrected</span>
                    </button>
                  </div>
                )}

                {editing?.id === libSel.id && (
                  <div className="bg-slate-950 border border-indigo-900/60 rounded-xl p-3 space-y-3">
                    <p className="text-[11px] font-bold text-indigo-300 flex items-center gap-1.5">
                      <Pencil className="w-3.5 h-3.5" /> Editing this post
                    </p>

                    {isFuture(libSel) && libSel.status === "sent" && !libSel.needs_recurpost_cleanup && (
                      <p className="text-[10px] text-amber-300/90 bg-amber-950/20 border border-amber-900/40 rounded-lg p-2 leading-relaxed">
                        This one is already queued at RecurPost. Saving corrects our copy, but you will still need to
                        delete post <b className="font-mono">{libSel.recurpost_post_id ?? "(id not recorded)"}</b> in
                        RecurPost and re-send — their API has no way to edit a queued post.
                      </p>
                    )}

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title</label>
                      <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Caption</label>
                      <textarea value={editing.caption} onChange={(e) => setEditing({ ...editing, caption: e.target.value })} rows={4}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white resize-none leading-relaxed focus:outline-none focus:border-indigo-500" />
                      {storyHasNoCaption(libSel.content_type) && editing.caption && (
                        <p className="mt-1 text-[10px] text-amber-400">Stories drop the caption — this text won&apos;t appear.</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Media</label>
                        <button onClick={() => editMediaRef.current?.click()} disabled={uploading === "media"}
                          className="w-full border border-dashed border-slate-800 hover:border-indigo-500 rounded-lg p-2 text-[10px] text-slate-400 cursor-pointer disabled:opacity-50">
                          {uploading === "media" ? `${uploadPct}%` : "Replace media"}
                        </button>
                        <input ref={editMediaRef} type="file" accept="image/*,video/mp4,video/quicktime" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadForEdit("media", f); e.target.value = ""; }} />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Thumbnail</label>
                        <button onClick={() => editThumbRef.current?.click()} disabled={uploading === "thumb"}
                          className="w-full border border-dashed border-slate-800 hover:border-indigo-500 rounded-lg p-2 text-[10px] text-slate-400 cursor-pointer disabled:opacity-50">
                          {uploading === "thumb" ? `${uploadPct}%` : editing.thumbnailUrl ? "Change thumbnail" : "Add thumbnail"}
                        </button>
                        <input ref={editThumbRef} type="file" accept="image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadForEdit("thumb", f); e.target.value = ""; }} />
                      </div>
                    </div>

                    {editing.thumbnailUrl && (
                      <div className="flex items-center gap-2">
                        <img src={editing.thumbnailUrl} alt="thumbnail" className="h-12 w-12 rounded-lg object-cover border border-slate-800" />
                        <button onClick={() => setEditing({ ...editing, thumbnailUrl: "" })}
                          className="text-[10px] text-slate-500 hover:text-rose-400 cursor-pointer">Remove thumbnail</button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date (IST)</label>
                        <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Time (IST)</label>
                        <input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button onClick={saveEdit} disabled={libBusy === editing.id || !!uploading}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1">
                        {libBusy === editing.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        <span>Save changes</span>
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-bold cursor-pointer">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
