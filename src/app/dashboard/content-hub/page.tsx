"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { UploadCloud, Image as ImageIcon, Film, Smartphone, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface ClientRow { id: string; name: string }
interface UploadRow {
  id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  media_type: "image" | "video";
  content_type: "post" | "reel" | "story";
  status: string;
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
  const inputRefs = { post: useRef<HTMLInputElement>(null), reel: useRef<HTMLInputElement>(null), story: useRef<HTMLInputElement>(null) };

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
      const { data } = await supabase.from("clients").select("id, name").order("name");
      setClients(data || []);
    })();
    fetchUploads();
  }, [fetchUploads]);

  const doUpload = async (contentType: string, file: File) => {
    if (!selectedClient) {
      setError("Please select a client / brand first.");
      return;
    }
    setError(null);
    setSuccess(null);
    setUploadingType(contentType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientId", selectedClient);
      fd.append("contentType", contentType);
      const res = await fetch("/api/content-hub", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setSuccess(`Uploaded "${file.name}" as ${contentType}. It's now available to the social team.`);
      await fetchUploads();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingType(null);
    }
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
                    const f = e.dataTransfer.files?.[0];
                    if (f) doUpload(key, f);
                  }}
                  className="flex-1 border border-dashed border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-2"
                >
                  {busy ? (
                    <Loader2 className={`w-6 h-6 animate-spin ${a.text}`} />
                  ) : (
                    <UploadCloud className={`w-6 h-6 ${a.text}`} />
                  )}
                  <p className="text-[11px] text-slate-500">{busy ? "Uploading…" : "Drag & drop your file here"}</p>
                  {!busy && <span className="text-[10px] text-slate-600">or</span>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputRefs[key].current?.click()}
                    className={`px-4 py-1.5 rounded-lg text-white text-xs font-bold ${a.btn} disabled:opacity-50 cursor-pointer`}
                  >
                    Browse Files
                  </button>
                  <input
                    ref={inputRefs[key]}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) doUpload(key, f);
                      e.target.value = "";
                    }}
                  />
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
                  <th className="py-2 pr-3 font-bold">Status</th>
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
                      <span className="px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400 text-[10px] font-bold capitalize">{u.status}</span>
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
