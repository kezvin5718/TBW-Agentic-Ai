"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { UploadCloud, Image as ImageIcon, Film, Smartphone, Loader2, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";

interface ClientRow { id: string; name: string }
interface UploadRow {
  id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  media_type: "image" | "video";
  content_type: "post" | "reel" | "story";
  status: string;
  qc_status?: "pending" | "match" | "mismatch" | "unsure" | "skipped";
  qc_detected_brand?: string | null;
  qc_note?: string | null;
  uploaded_by?: string | null;
  created_at: string;
  clients?: { name: string } | null;
  profiles?: { name: string } | null;
}

const TYPES = [
  { key: "post", label: "Post", Icon: ImageIcon, desc: "Square or landscape posts for the social media feed.", size: "1080 × 1080 or 1200 × 628 px", formats: "JPG, PNG, MP4, MOV", accent: "indigo" },
  { key: "reel", label: "Reel", Icon: Film, desc: "Vertical videos for short-form content.", size: "1080 × 1920 px (9:16)", formats: "MP4, MOV", accent: "pink" },
  { key: "story", label: "Story", Icon: Smartphone, desc: "Vertical stories for Instagram and Facebook.", size: "1080 × 1920 px (9:16)", formats: "JPG, PNG, MP4, MOV", accent: "amber" },
] as const;

const ACCENT: Record<string, { text: string; ring: string; btn: string }> = {
  indigo: { text: "text-indigo-400", ring: "border-indigo-500/60", btn: "bg-indigo-600 hover:bg-indigo-500" },
  pink: { text: "text-pink-400", ring: "border-pink-500/60", btn: "bg-pink-600 hover:bg-pink-500" },
  amber: { text: "text-amber-400", ring: "border-amber-500/60", btn: "bg-amber-600 hover:bg-amber-500" },
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const isDriveUrl = (u: string) => u.includes("googleusercontent.com");
const driveOpen = (u: string) => {
  const m = u.match(/googleusercontent\.com\/d\/([^=/?]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/view` : u;
};

export default function ContentHubPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Staged files per card — added first, uploaded only when "Upload" is clicked.
  const [staged, setStaged] = useState<Record<string, File[]>>({ post: [], reel: [], story: [] });
  // Staged thumbnails per card — paired to media by the number in the filename.
  const [stagedThumbs, setStagedThumbs] = useState<Record<string, File[]>>({ post: [], reel: [], story: [] });
  const inputRefs = { post: useRef<HTMLInputElement>(null), reel: useRef<HTMLInputElement>(null), story: useRef<HTMLInputElement>(null) };
  const thumbRefs = { post: useRef<HTMLInputElement>(null), reel: useRef<HTMLInputElement>(null), story: useRef<HTMLInputElement>(null) };

  const naturalSort = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

  // Last number in the filename ("Irin_Grid Reel_2.mp4" → 2) drives the pairing.
  const numOf = (name: string): number | null => {
    const m = name.replace(/\.[^.]+$/, "").match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : null;
  };
  // Pair a media file with its thumbnail: match by number, else by position.
  const thumbFor = (key: string, file: File, index: number): File | null => {
    const thumbs = stagedThumbs[key] || [];
    if (thumbs.length === 0) return null;
    const n = numOf(file.name);
    if (n !== null) {
      const hit = thumbs.find((t) => numOf(t.name) === n);
      if (hit) return hit;
    }
    const media = staged[key] || [];
    return thumbs.length === media.length ? thumbs[index] || null : null;
  };

  const addThumbs = (key: string, list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setStagedThumbs((prev) => {
      const existing = prev[key] || [];
      const merged = [...existing];
      for (const f of incoming) {
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      merged.sort(naturalSort);
      return { ...prev, [key]: merged };
    });
  };
  const removeThumb = (key: string, idx: number) =>
    setStagedThumbs((prev) => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== idx) }));
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

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/content-hub");
      if (res.ok) {
        const data = await res.json();
        setUploads(data.uploads || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setMe({ id: user.id, role: (user.user_metadata?.role as string) || "employee" });
      const { data } = await supabase.from("clients").select("id, name").order("name");
      setClients(data || []);
    })();
    fetchUploads();
  }, [fetchUploads]);

  // Brand QC — vision-check pending uploads against their selected brand.
  // Runs AFTER the user clicks Upload (and once on load to catch leftovers).
  const runQc = useCallback(async () => {
    try {
      const res = await fetch("/api/content-hub/qc", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.checked > 0) {
          await fetchUploads();
          if (data.flagged > 0) setError(`⚠ Brand QC flagged ${data.flagged} upload(s) as possibly the WRONG brand — check the Brand QC column below.`);
        }
      }
    } catch { /* ignore */ }
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
        const pairedThumb = thumbFor(contentType, files[i], i);
        if (pairedThumb) fd.append("thumbnail", pairedThumb);
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
    if ((failedNames || []).length === 0) setStagedThumbs((prev) => ({ ...prev, [key]: [] }));
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TYPES.map(({ key, label, Icon, desc, size, formats, accent }) => {
            const a = ACCENT[accent];
            const busy = uploadingType === key;
            const accept = key === "reel" ? "video/mp4,video/quicktime" : "image/*,video/mp4,video/quicktime";
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
                    className={`px-4 py-1.5 rounded-lg text-white text-xs font-bold ${a.btn} disabled:opacity-50 cursor-pointer`}
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

                {/* Thumbnails — paired to the media above by filename number */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addThumbs(key, e.dataTransfer.files); }}
                  className="mt-2 border border-dashed border-slate-800/70 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Thumbnails <span className="normal-case font-medium text-slate-600">(optional — matched by number)</span></p>
                    <p className="text-[9px] text-slate-600">{(stagedThumbs[key]?.length || 0)} added</p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => thumbRefs[key].current?.click()} className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-[10px] font-bold text-slate-300 cursor-pointer shrink-0">
                    + Add thumbs
                  </button>
                  <input ref={thumbRefs[key]} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { if (e.target.files?.length) addThumbs(key, e.target.files); e.target.value = ""; }} />
                </div>

                {/* Unpaired thumbnails (added but no matching media number yet) */}
                {(stagedThumbs[key]?.length || 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {stagedThumbs[key].map((t, i) => {
                      const used = (staged[key] || []).some((f, idx) => thumbFor(key, f, idx)?.name === t.name);
                      return (
                        <span key={`${t.name}-${t.size}`} className={`text-[9px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${used ? "bg-emerald-950/30 border-emerald-900 text-emerald-400" : "bg-amber-950/20 border-amber-900/60 text-amber-400"}`}>
                          {used ? "✓" : "⚠"} {t.name}
                          <button type="button" onClick={() => removeThumb(key, i)} className="hover:text-rose-400 cursor-pointer">✕</button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Staged files — review order, remove mistakes, then Upload */}
                <div className="mt-3 space-y-2">
                  {(staged[key]?.length || 0) > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                      {staged[key].map((f, i) => {
                        const pt = thumbFor(key, f, i);
                        return (
                          <div key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-2 bg-slate-950/80 border border-slate-900 rounded-lg px-2 py-1">
                            <span className="text-[10px] text-slate-300 truncate">
                              <span className={`font-black mr-1.5 ${a.text}`}>{i + 1}.</span>{f.name}
                              {pt ? <span className="text-emerald-400 ml-1.5">🖼 {pt.name}</span> : null}
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
                      className={`flex-1 py-2 rounded-lg text-white text-xs font-bold ${a.btn} disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                    >
                      {busy
                        ? `Uploading ${uploadCount ? `${uploadCount.done + 1}/${uploadCount.total}` : ""}…`
                        : (staged[key]?.length || 0) === 0
                        ? "⬆ Upload (add files first)"
                        : `⬆ Upload ${staged[key].length} file${staged[key].length > 1 ? "s" : ""} & run QC`}
                    </button>
                    {(staged[key]?.length || 0) > 0 && (
                      <button type="button" disabled={busy} onClick={() => clearStaged(key)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold cursor-pointer">Clear</button>
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

      {/* Recent uploads */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-white mb-3">Recent Uploads</h3>
        {uploads.length === 0 ? (
          <p className="text-xs text-slate-600 py-6 text-center">No uploads yet. Select a client and upload a creative above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left border-b border-slate-900">
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
                  <tr key={u.id} className="border-b border-slate-900/60 text-slate-300">
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
                    <td className="py-2 pr-3">{u.clients?.name || "—"}</td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-bold capitalize">{u.content_type}</span>
                    </td>
                    <td className="py-2 pr-3">{fmtSize(u.file_size)}</td>
                    <td className="py-2 pr-3">{u.profiles?.name || "—"}</td>
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
