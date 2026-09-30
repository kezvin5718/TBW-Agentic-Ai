"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Avatar from "../Avatar";
import { UploadCloud, Image as ImageIcon, Film, Smartphone, Loader2, CheckCircle2, AlertTriangle, Trash2, Sparkles, Layers } from "lucide-react";
import { fmtIST } from "@/lib/time";

interface ClientRow { id: string; name: string }
interface UploadRow {
  id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  media_type: "image" | "video";
  content_type: "post" | "reel" | "story" | "thumbnail";
  status: string;
  client_id?: string | null;
  festival_id?: string | null;
  qc_status?: "pending" | "match" | "mismatch" | "unsure" | "skipped";
  qc_detected_brand?: string | null;
  qc_detected_festival?: string | null;
  qc_note?: string | null;
  uploaded_by?: string | null;
  created_at: string;
  clients?: { name: string } | null;
  profiles?: { name: string; avatar_url?: string | null; designation?: string | null } | null;
}

/**
 * Editors export from Premiere, CapCut, phones and WhatsApp, so the same reel
 * arrives as .mp4, .mov, .m4v or occasionally .mkv — and the MIME the browser
 * reports for it is not dependable. Accept both spellings of every format.
 */
const VIDEO_MIME = "video/mp4,video/quicktime,video/x-m4v,video/webm";
const VIDEO_EXT = ".mp4,.mov,.m4v,.webm,.mkv,.avi";
const IMAGE_EXT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.gif";

const TYPES = [
  { key: "post", label: "Post", Icon: ImageIcon, desc: "Square or landscape posts for the social media feed.", size: "1080 × 1080 or 1200 × 628 px", formats: "JPG, PNG, MP4, MOV, WEBM", accent: "indigo" },
  { key: "reel", label: "Reel", Icon: Film, desc: "Vertical videos for short-form content.", size: "1080 × 1920 px (9:16)", formats: "MP4, MOV, M4V, WEBM", accent: "pink" },
  { key: "story", label: "Story", Icon: Smartphone, desc: "Vertical stories for Instagram and Facebook.", size: "1080 × 1920 px (9:16)", formats: "JPG, PNG, MP4, MOV, WEBM", accent: "amber" },
  { key: "thumbnail", label: "Thumbnail", Icon: ImageIcon, desc: "Reel/video covers made by the designer — numbered to match the reels.", size: "1080 × 1920 px (9:16)", formats: "JPG, PNG, WEBP, HEIC", accent: "emerald" },
] as const;

const ACCENT: Record<string, { text: string; ring: string; btn: string }> = {
  indigo: { text: "text-indigo-400", ring: "border-indigo-500/60", btn: "bg-indigo-600 hover:bg-indigo-500" },
  pink: { text: "text-pink-400", ring: "border-pink-500/60", btn: "bg-pink-600 hover:bg-pink-500" },
  amber: { text: "text-amber-400", ring: "border-amber-500/60", btn: "bg-amber-600 hover:bg-amber-500" },
  emerald: { text: "text-emerald-400", ring: "border-emerald-500/60", btn: "bg-emerald-600 hover:bg-emerald-500" },
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const norm = (s: string) => s.trim().toLowerCase();
/** A festival batch is a festival morning — ten creatives, not a delivery. */
const BATCH_MAX = 10;
type HubTab = "regular" | "festivals";
interface BatchOutcome { id: string; file_name: string | null; scheduled: boolean; platforms: number; notes: string[] }
const isDriveUrl = (u: string) => u.includes("googleusercontent.com");
const driveOpen = (u: string) => {
  const m = u.match(/googleusercontent\.com\/d\/([^=/?]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/view` : u;
};

export default function ContentHubPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedClient, setSelectedClient] = useState("");

  // --- Festival Story ---------------------------------------------------------
  const [festivals, setFestivals] = useState<Array<{ id: string; name: string; scheduled_at: string }>>([]);
  const [festivalId, setFestivalId] = useState("");
  const festivalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/festivals");
        if (res.ok) setFestivals((await res.json()).festivals || []);
      } catch { /* the section explains itself when the list is empty */ }
    })();
  }, []);

  /**
   * A festival creative goes up as a story with its festival attached, and QC
   * takes it from there — on a pass it schedules itself, on a failure it stays
   * here flagged. Nobody composes it and nobody picks a time.
   */
  const uploadFestivalStory = async (file: File) => {
    if (!selectedClient || !festivalId) return;
    setError(null);
    setSuccess(null);
    setUploadingType("festival");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientId", selectedClient);
      fd.append("contentType", "story");
      fd.append("festivalId", festivalId);
      const res = await fetch("/api/content-hub", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const fest = festivals.find((f) => f.id === festivalId)?.name || "the festival";
      setSuccess(`"${file.name}" uploaded for ${fest}. QC is checking the brand and the festival now — it schedules itself if both are right.`);
      setFestivalId("");
      await fetchUploads();
      runQc();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally { setUploadingType(null); }
  };
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Staged files per card — added first, uploaded only when "Upload" is clicked.
  const [staged, setStaged] = useState<Record<string, File[]>>({ post: [], reel: [], story: [], thumbnail: [] });
  const inputRefs = {
    post: useRef<HTMLInputElement>(null),
    reel: useRef<HTMLInputElement>(null),
    story: useRef<HTMLInputElement>(null),
    thumbnail: useRef<HTMLInputElement>(null),
  };

  const naturalSort = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const addFiles = (key: string, list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setStaged((prev) => {
      const existing = prev[key] || [];
      const merged = [...existing];
      for (const f of incoming) {
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      merged.sort(naturalSort);
      return { ...prev, [key]: merged };
    });
    setSuccess(null);
  };
  const removeStaged = (key: string, idx: number) =>
    setStaged((prev) => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== idx) }));
  const clearStaged = (key: string) => setStaged((prev) => ({ ...prev, [key]: [] }));

  // Multi-select delete for the Recent Uploads table
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const canDelete = (u: UploadRow) => u.status === "uploaded" && (me?.role === "founder" || u.uploaded_by === me?.id);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const deletableRows = uploads.filter(canDelete);
  const allSelected = deletableRows.length > 0 && deletableRows.every((u) => selectedIds.includes(u.id));
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? [] : deletableRows.map((u) => u.id));

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} upload(s)? This removes them for the social team too.`)) return;
    setDeleting("bulk");
    try {
      const res = await fetch("/api/content-hub", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setSelectedIds([]);
      await fetchUploads();
      setSuccess(`Deleted ${data.deleted} upload(s)${data.skipped ? `, ${data.skipped} skipped (already scheduled or not yours)` : ""}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const deleteUpload = async (id: string) => {
    if (!window.confirm("Delete this upload? This removes it for the social team too.")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/content-hub", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await fetchUploads();
      setSuccess("Upload deleted.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  // Returns the fresh list too, for the festival batch's wait-for-QC loop —
  // it can't read state it has just set.
  const fetchUploads = useCallback(async (): Promise<UploadRow[] | null> => {
    try {
      const res = await fetch("/api/content-hub");
      if (res.ok) {
        const data = await res.json();
        setUploads(data.uploads || []);
        return (data.uploads || []) as UploadRow[];
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setMe({ id: user.id, role: (user.user_metadata?.role as string) || "employee" });
      const { data } = await supabase.from("clients").select("id, name").is("archived_at", null).order("name");
      setClients(data || []);
    })();
    fetchUploads();
  }, [fetchUploads]);

  // Brand QC — vision-check pending uploads against their selected brand.
  // Runs AFTER the user clicks Upload (and once on load to catch leftovers).
  const runQc = useCallback(async (): Promise<{ checked?: number } | null> => {
    try {
      const res = await fetch("/api/content-hub/qc", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.checked > 0) {
          await fetchUploads();
          if (data.flagged > 0) setError(`⚠ Brand QC flagged ${data.flagged} upload(s) as possibly the WRONG brand — check the Brand QC column below.`);
        }
        return data;
      }
    } catch { /* ignore */ }
    return null;
  }, [fetchUploads]);

  useEffect(() => { runQc(); }, [runQc]); // catch anything pending from earlier

  const [uploadCount, setUploadCount] = useState<{ done: number; total: number } | null>(null);

  // Upload one or many files. Files are naturally sorted by their filename
  // numbering (1, 2, … 9, 10 — not 1, 10, 2) and uploaded sequentially so the
  // sequence is preserved for the social team.
  const doUpload = async (contentType: string, fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    if (!selectedClient) {
      setError("Please select a client / brand first.");
      return;
    }
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    setError(null);
    setSuccess(null);
    setUploadingType(contentType);
    // One batch per upload: these files were delivered together and QC judges
    // them together, so one bad creative sends the whole set back rather than
    // letting half of it through.
    const batchId = crypto.randomUUID();
    let ok = 0;
    const failed: string[] = [];
    const failedNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setUploadCount({ done: i, total: files.length });
      try {
        const fd = new FormData();
        fd.append("file", files[i]);
        fd.append("clientId", selectedClient);
        fd.append("contentType", contentType);
        fd.append("batchId", batchId);
        const res = await fetch("/api/content-hub", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        ok++;
      } catch (err: unknown) {
        failed.push(`${files[i].name} (${err instanceof Error ? err.message : "failed"})`);
        failedNames.push(files[i].name);
      }
    }
    setUploadCount(null);
    setUploadingType(null);
    await fetchUploads();
    runQc(); // brand-check the fresh uploads in the background
    if (failed.length === 0) {
      setSuccess(files.length > 1
        ? `Uploaded ${ok} files as ${contentType} in filename order (${files[0].name} → ${files[files.length - 1].name}). Brand QC is checking them now…`
        : `Uploaded "${files[0].name}" as ${contentType}. Brand QC is checking it now…`);
    } else {
      setError(`${ok} uploaded, ${failed.length} failed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "…" : ""}`);
    }
    return failedNames;
  };

  // Upload everything staged in a card; failed files stay staged for retry.
  const uploadStaged = async (key: string) => {
    const files = staged[key] || [];
    if (files.length === 0) return;
    const failedNames = await doUpload(key, files);
    setStaged((prev) => ({ ...prev, [key]: (prev[key] || []).filter((f) => (failedNames || []).includes(f.name)) }));
  };

  // --- Sections ----------------------------------------------------------------
  // Regular posting and Festivals are two jobs with two different endings — one
  // is handed to the social team, the other schedules itself. The library below
  // both is the same list either way, so it is rendered once, outside the tabs.
  const [tab, setTab] = useState<HubTab>("regular");

  // --- Festival batch ------------------------------------------------------------
  // A festival morning is ten brands' greetings at once, dropped with no client
  // chosen. QC names the brand on each, a person confirms or corrects it, and one
  // Submit schedules every one at the festival's own time.
  const [batchFestivalId, setBatchFestivalId] = useState("");
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<Record<string, "waiting" | "uploading" | "done" | "failed">>({});
  const [batchRows, setBatchRows] = useState<UploadRow[]>([]);
  const [batchPicks, setBatchPicks] = useState<Record<string, string>>({});
  const [batchBusy, setBatchBusy] = useState<"uploading" | "checking" | "submitting" | "removing" | null>(null);

  /** A mistaken upload leaves the batch AND the hub — gone, not hidden. */
  const removeBatchCard = async (c: UploadRow) => {
    if (!confirm(`Remove "${c.file_name || "this creative"}"? It is deleted from the hub — this cannot be undone.`)) return;
    setBatchBusy("removing");
    try {
      const res = await fetch("/api/content-hub", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [c.id] }),
      });
      if (res.ok) {
        setBatchRows((rows) => rows.filter((r) => r.id !== c.id));
        setBatchPicks((p) => { const n = { ...p }; delete n[c.id]; return n; });
        await fetchUploads();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not remove it.");
      }
    } finally { setBatchBusy(null); }
  };
  const [batchResults, setBatchResults] = useState<Record<string, BatchOutcome>>({});
  const batchInputRef = useRef<HTMLInputElement>(null);
  const fileKey = (f: File) => `${f.name}-${f.size}`;

  // A reload mid-batch must not strand creatives with no client and no card to
  // give them one. On first load, any unsubmitted client-less festival rows
  // come back as cards — the latest festival's, so the Submit label is true.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || uploads.length === 0) return;
    resumedRef.current = true;
    const orphans = uploads.filter((u) => u.festival_id && !u.client_id && u.status === "uploaded");
    if (orphans.length === 0) return;
    const fest = orphans[0].festival_id!;
    setBatchRows(orphans.filter((u) => u.festival_id === fest).reverse());
    setBatchFestivalId(fest);
  }, [uploads]);

  // Upcoming festivals first, soonest at the top; the ones already gone after.
  const now = Date.now();
  const festivalsUpcomingFirst = [
    ...festivals.filter((f) => new Date(f.scheduled_at).getTime() >= now),
    ...festivals.filter((f) => new Date(f.scheduled_at).getTime() < now).reverse(),
  ];

  const addBatchFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter(
      (f) => f.type.startsWith("image") || f.type.startsWith("video") || /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name)
    );
    if (incoming.length === 0) return;
    let dropped = 0;
    const merged = [...batchFiles];
    for (const f of incoming) {
      if (merged.some((m) => fileKey(m) === fileKey(f))) continue;
      if (merged.length >= BATCH_MAX) { dropped++; continue; }
      merged.push(f);
    }
    setBatchFiles(merged.sort(naturalSort));
    setSuccess(null);
    if (dropped > 0) setError(`A festival batch takes up to ${BATCH_MAX} creatives — ${dropped} were left out. Upload them as a second batch.`);
  };

  // What the library currently says about each card — the POST row until the
  // first refresh brings QC's reading.
  const batchCards = batchRows.map((r) => uploads.find((u) => u.id === r.id) || r);
  const clientIdForName = (name: string | null | undefined) =>
    name ? clients.find((c) => norm(c.name) === norm(name))?.id || "" : "";
  const cardView = (c: UploadRow) => {
    const detectedId = clientIdForName(c.qc_detected_brand);
    return {
      detectedId,
      pending: c.qc_status === "pending",
      rejected: c.qc_status === "mismatch" || c.status === "rejected",
      done: c.status === "scheduled",
      // The person's pick wins; then a client already saved on the row (a
      // retry after a blocked submit); then QC's suggestion.
      pick: batchPicks[c.id] ?? (c.client_id || detectedId || ""),
    };
  };
  const openCards = batchCards.filter((c) => { const v = cardView(c); return !v.rejected && !v.done; });
  const stillReading = openCards.filter((c) => cardView(c).pending).length;
  const unpicked = openCards.filter((c) => !cardView(c).pending && !cardView(c).pick).length;
  const batchFestival =
    festivals.find((f) => f.id === (openCards[0]?.festival_id || batchCards[0]?.festival_id)) ||
    festivals.find((f) => f.id === batchFestivalId);
  const canSubmitBatch = !batchBusy && openCards.length > 0 && stillReading === 0 && unpicked === 0;

  /**
   * QC reads ten pending creatives per call, oldest first, so a batch can take
   * more than one sweep — and the page's own on-load sweep may already be
   * reading some of them. Keep asking until none of this batch is pending.
   */
  const waitForDetections = async (ids: string[]) => {
    for (let round = 0; round < 10; round++) {
      const res = await runQc();
      const list = (await fetchUploads()) || [];
      const mine = list.filter((u) => ids.includes(u.id));
      if (mine.length > 0 && !mine.some((u) => u.qc_status === "pending")) return;
      if (!res?.checked) await new Promise((r) => setTimeout(r, 3000));
    }
  };

  const uploadBatch = async () => {
    if (!batchFestivalId || batchFiles.length === 0) return;
    resumedRef.current = true; // these cards are this session's own
    setError(null);
    setSuccess(null);
    setBatchBusy("uploading");
    const files = [...batchFiles].sort(naturalSort);
    setBatchProgress(Object.fromEntries(files.map((f) => [fileKey(f), "waiting" as const])));
    // One request per file so each card shows its own progress; the shared id
    // keeps them one batch on the record.
    const batchId = crypto.randomUUID();
    const fresh: UploadRow[] = [];
    const failed: string[] = [];
    for (const f of files) {
      setBatchProgress((p) => ({ ...p, [fileKey(f)]: "uploading" }));
      try {
        const fd = new FormData();
        fd.append("files[]", f);
        fd.append("festivalId", batchFestivalId);
        fd.append("batchId", batchId);
        const res = await fetch("/api/content-hub/festival-batch", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.uploads?.length) throw new Error(data.failed?.[0]?.error || data.error || "Upload failed");
        fresh.push(...(data.uploads as UploadRow[]));
        setBatchProgress((p) => ({ ...p, [fileKey(f)]: "done" }));
      } catch (err: unknown) {
        failed.push(`${f.name} (${err instanceof Error ? err.message : "failed"})`);
        setBatchProgress((p) => ({ ...p, [fileKey(f)]: "failed" }));
      }
    }
    // Failed files stay staged for a retry; the rest become cards.
    setBatchFiles((prev) => prev.filter((f) => failed.some((m) => m.startsWith(`${f.name} (`))));
    setBatchRows((prev) => [...prev, ...fresh]);
    if (failed.length > 0) setError(`${fresh.length} uploaded, ${failed.length} failed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "…" : ""}`);
    if (fresh.length === 0) { setBatchBusy(null); return; }

    setBatchBusy("checking");
    await fetchUploads();
    await waitForDetections(fresh.map((r) => r.id));
    setBatchBusy(null);
  };

  const submitBatch = async () => {
    if (!canSubmitBatch) return;
    setError(null);
    setSuccess(null);
    setBatchBusy("submitting");
    try {
      const res = await fetch("/api/content-hub/festival-batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: openCards.map((c) => ({ id: c.id, clientId: cardView(c).pick })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      const results = (data.results || []) as BatchOutcome[];
      setBatchResults((prev) => ({ ...prev, ...Object.fromEntries(results.map((r) => [r.id, r])) }));
      await fetchUploads();
      const when = batchFestival ? fmtIST(batchFestival.scheduled_at, { weekday: "short" }) : "the festival's time";
      if (data.blocked > 0) {
        setError(`${data.scheduled} scheduled, ${data.blocked} blocked — each card says why.`);
      } else {
        setSuccess(`${data.scheduled} ${data.scheduled === 1 ? "story" : "stories"} scheduled for ${when}. They're in the Social Publisher library.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBatchBusy(null);
    }
  };

  // Clears the cards — nothing on the record changes. Anything unsubmitted is
  // still in the library below, flagged "— pick a client".
  const clearBatch = () => {
    setBatchRows([]);
    setBatchPicks({});
    setBatchResults({});
    setBatchProgress({});
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <UploadCloud className="w-6 h-6 text-indigo-400" />
          <span>Upload Your Creative</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Upload designs and videos for social media. The social team will review, schedule, and post them.</p>
      </div>

      {error && (
        <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-3 text-sm text-rose-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/30 border border-emerald-900/60 rounded-xl p-3 text-sm text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> <span>{success}</span>
        </div>
      )}

      {/* Same pills as Task Manager. Two tabs never need the sideways scroll,
          but they get the same row so the control reads the same everywhere. */}
      <div className="flex flex-nowrap overflow-x-auto no-scrollbar snap-x md:flex-wrap md:overflow-visible bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider w-fit max-w-full">
        {([
          { key: "regular", label: "Regular posting", Icon: UploadCloud },
          { key: "festivals", label: "Festivals", Icon: Sparkles },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 snap-start px-4 py-2 min-h-[40px] lg:min-h-0 rounded-lg cursor-pointer transition-all flex items-center gap-2 ${
              tab === key ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === "regular" && (<>
      {/* Step 1: Select client */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <div className="flex items-center space-x-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">1</span>
          <div>
            <h3 className="text-sm font-bold text-white">Select Client / Brand</h3>
            <p className="text-[11px] text-slate-500">Choose the client this content is for.</p>
          </div>
        </div>
        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          className="w-full bg-slate-900/60 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">— Select Client / Brand —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Step 2: Content type upload cards */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <div className="flex items-center space-x-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">2</span>
          <h3 className="text-sm font-bold text-white">Choose the type of content you want to upload</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {TYPES.map(({ key, label, Icon, desc, size, formats, accent }) => {
            const a = ACCENT[accent];
            const busy = uploadingType === key;
            // Match on extension as well as MIME. Listing MIME types alone
            // greys the file out in the picker whenever the OS reports
            // something unexpected — an .mp4 as application/octet-stream, a
            // .mov as video/x-quicktime — which reads as "I can't select my
            // video at all", and nothing ever reaches the staging list.
            const accept =
              key === "reel" ? `${VIDEO_MIME},${VIDEO_EXT}`
              : key === "thumbnail" ? `image/*,${IMAGE_EXT}`
              : `image/*,${VIDEO_MIME},${IMAGE_EXT},${VIDEO_EXT}`;
            return (
              <div key={key} className={`rounded-2xl border ${a.ring} bg-slate-950/60 p-4 flex flex-col`}>
                <div className="flex items-center space-x-2 mb-3">
                  <Icon className={`w-5 h-5 ${a.text}`} />
                  <div>
                    <h4 className="text-sm font-bold text-white">{label}</h4>
                    <p className="text-[10px] text-slate-500">{desc}</p>
                  </div>
                </div>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.length) addFiles(key, e.dataTransfer.files);
                  }}
                  className="flex-1 border border-dashed border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2"
                >
                  {busy ? (
                    <Loader2 className={`w-6 h-6 animate-spin ${a.text}`} />
                  ) : (
                    <UploadCloud className={`w-6 h-6 ${a.text}`} />
                  )}
                  <p className="text-[11px] text-slate-500">
                    {busy
                      ? `Uploading ${uploadCount ? `${uploadCount.done + 1} of ${uploadCount.total}` : ""}…`
                      : "Drag & drop files here (multiple allowed)"}
                  </p>
                  {!busy && <span className="text-[10px] text-slate-600">or</span>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputRefs[key].current?.click()}
                    className={`px-4 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg text-white text-xs font-bold ${a.btn} disabled:opacity-50 cursor-pointer`}
                  >
                    Add Files
                  </button>
                  <input
                    ref={inputRefs[key]}
                    type="file"
                    accept={accept}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(key, e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {/* Staged files — review order, remove mistakes, then Upload */}
                <div className="mt-3 space-y-2">
                  {(staged[key]?.length || 0) > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                      {staged[key].map((f, i) => {
                        return (
                          <div key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-2 bg-slate-950/80 border border-slate-900 rounded-lg px-2 py-1">
                            <span className="text-[10px] text-slate-300 truncate">
                              <span className={`font-black mr-1.5 ${a.text}`}>{i + 1}.</span>{f.name}
                            </span>
                            <button type="button" disabled={busy} onClick={() => removeStaged(key, i)} className="text-slate-600 hover:text-rose-400 text-xs font-bold cursor-pointer shrink-0">✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || !selectedClient || (staged[key]?.length || 0) === 0}
                      onClick={() => uploadStaged(key)}
                      title={!selectedClient ? "Select a client first" : (staged[key]?.length || 0) === 0 ? "Add files first" : ""}
                      className={`flex-1 py-2 min-h-[40px] lg:min-h-0 rounded-lg text-white text-xs font-bold ${a.btn} disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                    >
                      {/* Name the actual blocker — saying "add files first"
                          when a client was never picked sends people hunting
                          for a problem with their files. */}
                      {busy
                        ? `Uploading ${uploadCount ? `${uploadCount.done + 1}/${uploadCount.total}` : ""}…`
                        : !selectedClient
                        ? "⬆ Upload (pick a client above first)"
                        : (staged[key]?.length || 0) === 0
                        ? "⬆ Upload (add files first)"
                        : `⬆ Upload ${staged[key].length} file${staged[key].length > 1 ? "s" : ""} & run QC`}
                    </button>
                    {(staged[key]?.length || 0) > 0 && (
                      <button type="button" disabled={busy} onClick={() => clearStaged(key)} className="px-3 py-2 min-h-[40px] lg:min-h-0 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold cursor-pointer">Clear</button>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-[9px] text-slate-600 leading-relaxed">
                  <p className="font-bold text-slate-500 uppercase tracking-wider">Recommended</p>
                  <p>{size}</p>
                  <p>Formats: {formats}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      </>)}

      {tab === "festivals" && (<>
      {/* Festival Story — its own lane. Everything else in the hub is handed on
          to someone to compose and post; this one schedules itself. */}
      <div className="bg-gradient-to-br from-amber-950/20 to-slate-950/40 border border-amber-900/50 rounded-2xl p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-5 h-5 text-[var(--yellow)]" />
          <div>
            <h3 className="text-sm font-bold text-white">Festival Story</h3>
            <p className="text-[11px] text-slate-500">
              Pick the festival, upload the creative, done. It is QC-checked, then scheduled as a Story at that festival&apos;s own time and appears in the Library. No caption, and it never goes to Social Publisher.
            </p>
          </div>
        </div>

        {festivals.length === 0 ? (
          <p className="text-[11px] text-amber-300/80">
            No festivals on the list yet — add one under <b>8b · Festivals</b> in the sidebar first.
          </p>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            {/* The client picker used to sit above this section on one page.
                It lives on the Regular tab now, so this lane carries its own —
                the same selection, so switching tabs never loses it. */}
            <div className="flex-1 min-w-[220px]">
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Client</span>
              <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-white focus:outline-none focus:border-amber-500 cursor-pointer">
                <option value="">— Select Client / Brand —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[220px]">
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Festival</span>
              <select value={festivalId} onChange={(e) => setFestivalId(e.target.value)}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-white focus:outline-none focus:border-amber-500 cursor-pointer">
                <option value="">— Select festival —</option>
                {festivals.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {fmtIST(f.scheduled_at, { weekday: "short" })}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => festivalRef.current?.click()}
              disabled={!selectedClient || !festivalId || uploadingType === "festival"}
              title={!selectedClient ? "Select a client first" : !festivalId ? "Select a festival first" : ""}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                selectedClient && festivalId && uploadingType !== "festival"
                  ? "bg-[var(--yellow)] text-black hover:brightness-110 cursor-pointer"
                  : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"
              }`}>
              {uploadingType === "festival" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              <span>{uploadingType === "festival" ? "Uploading…" : "Upload creative"}</span>
            </button>
            <input
              ref={festivalRef} type="file" accept="image/*,video/mp4,video/quicktime,.mp4,.mov,.jpg,.jpeg,.png,.webp,.heic"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFestivalStory(f); e.target.value = ""; }}
            />
          </div>
        )}

        <p className="text-[10px] text-slate-600">
          QC checks the brand <b>and</b> the festival. If either is wrong it is not scheduled — it stays here, flagged, for someone to fix.
        </p>
      </div>

      {/* Festival batch — many brands in one drop. Nobody picks a client up
          front: QC names the brand on each creative, a person confirms it on
          the card, and Submit schedules the lot at the festival's own time. */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <Layers className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="text-sm font-bold text-white">Festival batch — many brands at once</h3>
            <p className="text-[11px] text-slate-500">
              Drop up to {BATCH_MAX} creatives for different clients. QC reads the brand on each and preselects the client; check every card, then schedule them all as Stories at the festival&apos;s time. No captions.
            </p>
          </div>
        </div>

        {festivals.length === 0 ? (
          <p className="text-[11px] text-amber-300/80">
            No festivals on the list yet — add one under <b>8b · Festivals</b> in the sidebar first.
          </p>
        ) : (
          <>
            <div>
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Festival</span>
              <select
                value={batchFestivalId}
                onChange={(e) => setBatchFestivalId(e.target.value)}
                // One batch, one festival: the cards on screen are filed under
                // it, so it can't change underneath them.
                disabled={openCards.length > 0 || !!batchBusy}
                title={openCards.length > 0 ? "Schedule or clear the cards below before switching festival" : ""}
                className="w-full bg-slate-900/60 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">— Select festival —</option>
                {festivalsUpcomingFirst.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · posts {fmtIST(f.scheduled_at, { weekday: "short" })}
                    {new Date(f.scheduled_at).getTime() < now ? " (past)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!batchBusy && e.dataTransfer.files?.length) addBatchFiles(e.dataTransfer.files);
              }}
              className="border border-dashed border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2"
            >
              {batchBusy === "uploading" || batchBusy === "checking" ? (
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              ) : (
                <UploadCloud className="w-6 h-6 text-indigo-400" />
              )}
              <p className="text-[11px] text-slate-500">
                {batchBusy === "uploading"
                  ? "Uploading…"
                  : batchBusy === "checking"
                  ? "QC is reading the brand on each creative…"
                  : `Drag & drop images or videos here — up to ${BATCH_MAX}, any mix of clients`}
              </p>
              <button
                type="button"
                disabled={!!batchBusy || batchFiles.length >= BATCH_MAX}
                onClick={() => batchInputRef.current?.click()}
                className="px-4 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg text-white text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
              >
                Add Files
              </button>
              <input
                ref={batchInputRef}
                type="file"
                accept={`image/*,${VIDEO_MIME},${IMAGE_EXT},${VIDEO_EXT}`}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addBatchFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {batchFiles.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {batchFiles.map((f, i) => {
                    const st = batchProgress[fileKey(f)];
                    return (
                      <div key={fileKey(f)} className="flex items-center justify-between gap-2 bg-slate-950/80 border border-slate-900 rounded-lg px-2 py-1">
                        <span className="text-[10px] text-slate-300 truncate min-w-0">
                          <span className="font-black mr-1.5 text-indigo-400">{i + 1}.</span>{f.name}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {st === "uploading" && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
                          {st === "waiting" && <span className="text-[9px] text-slate-600">waiting</span>}
                          {st === "failed" && <span className="text-[9px] text-rose-400 font-bold">failed</span>}
                          <button type="button" disabled={!!batchBusy} onClick={() => setBatchFiles((prev) => prev.filter((x) => fileKey(x) !== fileKey(f)))} className="text-slate-600 hover:text-rose-400 text-xs font-bold cursor-pointer">✕</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={!!batchBusy || !batchFestivalId}
                    onClick={uploadBatch}
                    className="flex-1 min-w-[200px] py-2 min-h-[40px] lg:min-h-0 rounded-lg text-white text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {batchBusy === "uploading"
                      ? `Uploading ${Object.values(batchProgress).filter((s) => s === "done" || s === "failed").length + 1}/${Object.keys(batchProgress).length}…`
                      : !batchFestivalId
                      ? "⬆ Upload (pick the festival first)"
                      : `⬆ Upload ${batchFiles.length} creative${batchFiles.length > 1 ? "s" : ""} & detect brands`}
                  </button>
                  <button type="button" disabled={!!batchBusy} onClick={() => setBatchFiles([])} className="px-3 py-2 min-h-[40px] lg:min-h-0 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold cursor-pointer">Clear</button>
                </div>
              </div>
            )}

            {batchCards.length > 0 && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {batchCards.map((c) => {
                    const v = cardView(c);
                    const result = batchResults[c.id];
                    const seen = String(c.qc_detected_brand || "").trim();
                    return (
                      <div
                        key={c.id}
                        className={`rounded-xl border p-3 flex gap-3 min-w-0 ${
                          v.rejected ? "border-rose-900/70 bg-rose-950/20"
                          : v.done ? "border-emerald-900/70 bg-emerald-950/10"
                          : "border-slate-800 bg-slate-950/60"
                        }`}
                      >
                        <div className="w-16 h-28 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                          {c.media_type === "video" ? (
                            <a href={driveOpen(c.file_url)} target="_blank" rel="noreferrer" title="Open video" className="w-full h-full flex items-center justify-center text-slate-500 hover:text-indigo-400">
                              <Film className="w-5 h-5" />
                            </a>
                          ) : (
                            <a href={driveOpen(c.file_url)} target="_blank" rel="noreferrer" title="Open">
                              <img src={c.file_url} alt={c.file_name || ""} className="w-full h-full object-cover" />
                            </a>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] text-slate-300 font-bold break-all min-w-0">{c.file_name}</p>
                            {/* A wrong file dies here, before it can be scheduled.
                                Queued cards lose the button: they are posts now. */}
                            {!v.done && (
                              <button onClick={() => removeBatchCard(c)} disabled={!!batchBusy} title="Remove this creative — deletes it from the hub"
                                className="shrink-0 w-8 h-8 -mt-1 -mr-1 flex items-center justify-center rounded-lg text-slate-600 hover:text-rose-400 cursor-pointer disabled:opacity-40">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {v.pending ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Loader2 className="w-3 h-3 animate-spin" /> QC is reading it…</span>
                          ) : v.rejected ? (
                            <p className="text-[10px] text-rose-300 leading-snug">
                              <b>Rejected — not schedulable.</b> {c.qc_note || "Looks like a different festival."}
                            </p>
                          ) : v.detectedId ? (
                            <span title={c.qc_note || ""} className="inline-block px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-300 text-[10px] font-bold">
                              QC sees: {seen}
                            </span>
                          ) : (
                            <span title={`${seen && norm(seen) !== "unknown" ? `Saw: ${seen}. ` : ""}${c.qc_note || ""}`} className="inline-block px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-bold cursor-help">
                              QC could not tell
                            </span>
                          )}

                          {!v.rejected && (
                            <select
                              value={v.pick}
                              onChange={(e) => setBatchPicks((p) => ({ ...p, [c.id]: e.target.value }))}
                              disabled={v.done || batchBusy === "submitting"}
                              className={`w-full min-h-[40px] lg:min-h-0 bg-slate-900/60 border rounded-lg py-1.5 px-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                                !v.pick && !v.pending ? "border-amber-700" : "border-slate-800"
                              }`}
                            >
                              <option value="">Pick a client…</option>
                              {clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                            </select>
                          )}

                          {v.done && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3 h-3" /> Queued{result?.platforms ? ` on ${result.platforms} platform${result.platforms > 1 ? "s" : ""}` : ""}
                            </span>
                          )}
                          {result && !result.scheduled && !v.done && (
                            <p className="text-[10px] text-amber-300 leading-snug">
                              <b>Blocked:</b> {result.notes.join(" ")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Sticky so ten cards can't scroll the Submit out of existence —
                    the founder's screenshot had it below the fold and read the
                    feature as unfinishable. */}
                <div className="sticky bottom-2 z-10 flex gap-2 flex-wrap items-center rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur p-2 shadow-lg shadow-black/50">
                  {Object.keys(batchResults).length > 0 && (
                    <span className="w-full text-[11px] font-bold text-emerald-400 px-1">
                      ✓ {Object.values(batchResults).filter((r) => r.scheduled).length} queued
                      {Object.values(batchResults).some((r) => !r.scheduled) &&
                        ` · ${Object.values(batchResults).filter((r) => !r.scheduled).length} blocked — see the cards`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={submitBatch}
                    disabled={!canSubmitBatch}
                    className={`flex-1 min-w-[220px] py-2.5 min-h-[40px] lg:min-h-0 rounded-lg text-xs font-bold transition-all ${
                      canSubmitBatch
                        ? "bg-[var(--yellow)] text-black hover:brightness-110 cursor-pointer"
                        : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"
                    }`}
                  >
                    {/* Name the blocker, same as the regular upload button. */}
                    {batchBusy === "submitting"
                      ? "Scheduling…"
                      : openCards.length === 0
                      ? "Nothing left to schedule"
                      : stillReading > 0
                      ? `QC is still reading ${stillReading}…`
                      : unpicked > 0
                      ? `Pick a client for ${unpicked} more creative${unpicked > 1 ? "s" : ""}`
                      : `Schedule ${openCards.length} ${openCards.length === 1 ? "story" : "stories"} at ${batchFestival ? fmtIST(batchFestival.scheduled_at, { weekday: "short" }) : "the festival's time"}`}
                  </button>
                  <button
                    type="button"
                    disabled={!!batchBusy}
                    onClick={clearBatch}
                    title="Clears these cards. Unsubmitted creatives stay in the library below."
                    className="px-3 py-2 min-h-[40px] lg:min-h-0 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
                  >
                    Start a new batch
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </>)}

      {/* Recent uploads */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-white">Recent Uploads</h3>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400 font-bold">{selectedIds.length} selected</span>
              <button
                onClick={deleteSelected}
                disabled={deleting === "bulk"}
                className="px-3 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 hover:bg-rose-900/40 text-[11px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting === "bulk" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Delete selected</span>
              </button>
              <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[11px] font-bold cursor-pointer">Clear</button>
            </div>
          )}
        </div>
        {uploads.length === 0 ? (
          <p className="text-xs text-slate-600 py-6 text-center">No uploads yet. Select a client and upload a creative above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="text-slate-500 text-left border-b border-slate-900">
                  <th className="py-2 pr-2 font-bold w-6">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={deletableRows.length === 0}
                      title="Select all deletable"
                      className="accent-[#FFD400] cursor-pointer"
                    />
                  </th>
                  <th className="py-2 pr-3 font-bold">Preview</th>
                  <th className="py-2 pr-3 font-bold">File</th>
                  <th className="py-2 pr-3 font-bold">Client</th>
                  <th className="py-2 pr-3 font-bold">Type</th>
                  <th className="py-2 pr-3 font-bold">Size</th>
                  <th className="py-2 pr-3 font-bold">By</th>
                  <th className="py-2 pr-3 font-bold">Brand QC</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 pr-3 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className={`border-b border-slate-900/60 text-slate-300 ${selectedIds.includes(u.id) ? "bg-rose-950/10" : ""}`}>
                    <td className="py-2 pr-2">
                      {canDelete(u) && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(u.id)}
                          onChange={() => toggleSelect(u.id)}
                          className="accent-[#FFD400] cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                        {u.media_type === "video" ? (
                          <a href={driveOpen(u.file_url)} target="_blank" rel="noreferrer" title="Open video" className="w-full h-full flex items-center justify-center text-slate-500 hover:text-indigo-400">
                            <Film className="w-4 h-4" />
                          </a>
                        ) : isDriveUrl(u.file_url) ? (
                          <a href={driveOpen(u.file_url)} target="_blank" rel="noreferrer" title="Open in Drive">
                            <img src={u.file_url} alt={u.file_name || ""} className="w-full h-full object-cover" />
                          </a>
                        ) : (
                          <img src={u.file_url} alt={u.file_name || ""} className="w-full h-full object-cover" />
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[180px] truncate">{u.file_name}</td>
                    {/* A festival-batch creative has no client until someone
                        confirms one on its card. */}
                    <td className="py-2 pr-3">{u.clients?.name || (u.client_id ? "—" : <span className="text-amber-400/80">— pick a client</span>)}</td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-bold capitalize">{u.content_type}</span>
                    </td>
                    <td className="py-2 pr-3">{fmtSize(u.file_size)}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={u.profiles?.name} url={u.profiles?.avatar_url} size={24} rounded="rounded-full"
                          title={u.profiles?.designation ? `${u.profiles.name} · ${u.profiles.designation}` : u.profiles?.name || ""} />
                        <span className="truncate">{u.profiles?.name || "—"}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {u.qc_status === "match" && <span className="px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400 text-[10px] font-bold">✓ Match</span>}
                      {u.qc_status === "mismatch" && (
                        <span title={`${u.qc_detected_brand ? `Looks like: ${u.qc_detected_brand}. ` : ""}${u.qc_note || ""}`} className="px-2 py-0.5 rounded-full bg-rose-950/40 border border-rose-900 text-rose-400 text-[10px] font-bold cursor-help">
                          ⚠ Wrong brand?{u.qc_detected_brand ? ` → ${u.qc_detected_brand}` : ""}
                        </span>
                      )}
                      {u.qc_status === "unsure" && <span title={u.qc_note || ""} className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-bold cursor-help">? Unclear</span>}
                      {u.qc_status === "pending" && <span className="text-[10px] text-slate-500">checking…</span>}
                      {u.qc_status === "skipped" && <span title={u.qc_note || ""} className="text-[10px] text-slate-600">—</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400 text-[10px] font-bold capitalize">{u.status}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {u.status === "uploaded" && (me?.role === "founder" || u.uploaded_by === me?.id) && (
                        <button
                          onClick={() => deleteUpload(u.id)}
                          disabled={deleting === u.id}
                          title="Delete this upload"
                          className="text-slate-600 hover:text-rose-400 cursor-pointer disabled:opacity-50"
                        >
                          {deleting === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
