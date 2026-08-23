"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Palette, UploadCloud, Loader2, Star, Trash2, CheckCircle2, AlertTriangle, RefreshCw, FileText, Settings2, Users } from "lucide-react";

interface Preset {
  id: string; category: string | null; image_url: string; file_name: string | null; mime: string | null;
  subject: string | null; tags: string[]; shot_type: string | null; occasion: string | null;
  prompt: Record<string, unknown>; starred: boolean; status: string; extract_error: string | null;
  suggested_category: string | null; auto_sorted: boolean;
}
interface Category { key: string; name: string; font_primary: string | null; font_secondary: string | null; notes: string | null }
interface ClientRow { id: string; name: string; default_style_category: string | null }
type Counts = Record<string, { approved: number; pending: number; failed: number }>;

const CATS = [
  { key: "traditional", name: "Traditional" },
  { key: "modern", name: "Modern" },
  { key: "surreal", name: "Surreal" },
  { key: "boutique", name: "Boutique" },
];
const MAX_MB = 500;

/**
 * The Style Library: the agency's proven jewellery looks. Staff drops old
 * designs in, the machine extracts a locked-schema JSON prompt from each, and
 * 5b pulls the best matches at Build time. Humans curate; machines type.
 */
export default function StyleLibraryPage() {
  const [tab, setTab] = useState("traditional");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [uploading, setUploading] = useState(false);
  // "" = each file is one design; otherwise each file is a grid composite to slice.
  const [gridMode, setGridMode] = useState("");
  const [forClient, setForClient] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClients, setShowClients] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const extractLock = useRef(false);

  const load = useCallback(async (category: string) => {
    try {
      const res = await fetch(`/api/style-library?category=${category}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setPresets(data.presets || []);
      setCategories(data.categories || []);
      setCounts(data.counts || {});
      setClients(data.clients || []);
    } catch { /* keep whatever is on screen */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { setLoading(true); load(tab); }, [tab, load]);

  // Extraction runs in small batches until nothing is pending — a 50-file drop
  // never rides on one request.
  const runExtraction = useCallback(async () => {
    if (extractLock.current) return;
    extractLock.current = true;
    setExtracting(true);
    try {
      for (let i = 0; i < 40; i++) {
        const res = await fetch("/api/style-library", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "extract" }),
        });
        if (!res.ok) break;
        const data = await res.json();
        await load(tab);
        if (!data.remaining) break;
      }
    } finally {
      extractLock.current = false;
      setExtracting(false);
    }
  }, [tab, load]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const total = list.reduce((s, f) => s + f.size, 0);
    if (total > MAX_MB * 1024 * 1024) {
      setNotice({ ok: false, text: `That's ${(total / 1024 / 1024).toFixed(0)}MB — the limit is ${MAX_MB}MB per upload. Split it into smaller drops.` });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("category", tab);
      if (gridMode) form.append("split", gridMode);
      if (forClient) form.append("clientId", forClient);
      for (const f of list) form.append("files", f);
      const res = await fetch("/api/style-library/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setNotice({ ok: true, text: data.message + (data.errors?.length ? ` Skipped: ${data.errors.join(" · ")}` : "") });
      await load(tab);
      runExtraction();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const review = async (id: string, patch: Record<string, unknown>) => {
    await fetch("/api/style-library", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "review", id, ...patch }),
    });
    await load(tab);
  };

  const remove = async (id: string) => {
    await fetch(`/api/style-library?id=${id}`, { method: "DELETE" });
    await load(tab);
  };

  const saveCategory = async (key: string, patch: Record<string, unknown>) => {
    await fetch("/api/style-library", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "category", key, ...patch }),
    });
    await load(tab);
    setNotice({ ok: true, text: "Category settings saved." });
  };

  const saveClientDefault = async (clientId: string, category: string) => {
    await fetch("/api/style-library", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clientDefault", clientId, category: category || null }),
    });
    await load(tab);
  };

  const cat = categories.find((c) => c.key === tab);
  const pendingHere = presets.filter((p) => p.status === "pending").length;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Palette className="w-6 h-6 text-[var(--yellow)]" /><span>Style Library</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Your proven looks, one JSON per old design. Drop designs in a category — the machine extracts the style, you curate, 5b uses the best matches at Build.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowClients((v) => !v)} className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center space-x-1.5 cursor-pointer ${showClients ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
            <Users className="w-3.5 h-3.5" /><span>Client defaults</span>
          </button>
          <button onClick={() => setShowSettings((v) => !v)} className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center space-x-1.5 cursor-pointer ${showSettings ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
            <Settings2 className="w-3.5 h-3.5" /><span>Fonts</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Category tabs + the auto-sort inbox */}
      <div className="flex gap-2 flex-wrap">
        {CATS.map((c) => {
          const n = counts[c.key];
          return (
            <button key={c.key} onClick={() => setTab(c.key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold border cursor-pointer flex items-center space-x-2 ${tab === c.key ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
              <span>{c.name}</span>
              {n && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-black/30">{n.approved}</span>}
              {n && n.pending > 0 && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400">{n.pending}⏳</span>}
            </button>
          );
        })}
        <button onClick={() => setTab("auto")}
          title="Drop mixed designs here — the extractor files each one on the right shelf; you can move any card after"
          className={`px-4 py-2.5 rounded-xl text-sm font-bold border cursor-pointer flex items-center space-x-2 ${tab === "auto" ? "bg-purple-600 border-purple-500 text-white" : "bg-slate-950 border-purple-900/60 text-purple-400 hover:text-purple-300"}`}>
          <span>✨ Auto-sort</span>
          {counts.auto && (counts.auto.pending + counts.auto.failed) > 0 && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-black/30">{counts.auto.pending + counts.auto.failed}</span>
          )}
        </button>
      </div>

      {/* Fonts / settings panel */}
      {showSettings && cat && (
        <CategorySettings key={cat.key} cat={cat} onSave={saveCategory} />
      )}

      {/* Client defaults panel */}
      {showClients && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
          <h3 className="text-sm font-bold text-white">Default style per client</h3>
          <p className="text-[11px] text-slate-500">Pre-selected in 5b for that client — changeable per plan there.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {clients.map((cl) => (
              <div key={cl.id} className="flex items-center gap-2 border border-slate-900 rounded-xl px-3 py-2 bg-slate-950/60">
                <span className="text-xs text-white font-semibold truncate flex-1">{cl.name}</span>
                <select value={cl.default_style_category || ""} onChange={(e) => saveClientDefault(cl.id, e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white cursor-pointer focus:outline-none">
                  <option value="">— none —</option>
                  {CATS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What is being dropped: individual designs, or grid composites to slice */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">Upload as</span>
        {[
          { v: "", label: "Single designs" },
          { v: "auto", label: "Grid · auto-detect" },
          { v: "3x3", label: "3×3" },
          { v: "2x2", label: "2×2" },
          { v: "3x4", label: "3×4" },
          { v: "3x2", label: "3×2" },
        ].map((o) => (
          <button key={o.v} onClick={() => setGridMode(o.v)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${gridMode === o.v ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"}`}>
            {o.label}
          </button>
        ))}
        {gridMode && <span className="text-[10px] text-slate-500">each file is sliced into tiles — every tile becomes its own design</span>}
      </div>

      {/* Whose look this is. A brand's own frames describe that brand; the shared
          shelf describes every other brand the agency has worked for. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">For client only</span>
        <select value={forClient} onChange={(e) => setForClient(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-300 cursor-pointer focus:outline-none focus:border-indigo-600">
          <option value="">All brands (shared shelf)</option>
          {clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
        </select>
        <span className="text-[10px] text-slate-500">
          {forClient
            ? "these designs steer only this client's posts — and outrank the shared shelf for them"
            : "optional — leave as-is unless these are one brand's own reference frames"}
        </span>
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
        className="border-2 border-dashed border-slate-800 hover:border-indigo-600 rounded-2xl p-8 text-center cursor-pointer transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)} />
        {uploading ? (
          <div className="flex items-center justify-center space-x-2 text-indigo-400"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm font-bold">Uploading to Drive…</span></div>
        ) : (
          <>
            <UploadCloud className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-white">
              {gridMode
                ? "Drop grid composites — each tile becomes its own design"
                : tab === "auto" ? "Drop a mixed pile of old designs — the bot files each one" : `Drop old ${CATS.find((c) => c.key === tab)?.name} designs here`}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              JPG, PNG or PDF · up to {MAX_MB}MB per upload · bulk is fine — extraction runs by itself after
              {tab === "auto" ? " and each design lands on the shelf it belongs to (moveable)" : ""}
            </p>
          </>
        )}
      </div>

      {/* Extraction status */}
      {(pendingHere > 0 || extracting) && (
        <div className="flex items-center justify-between bg-amber-950/20 border border-amber-900/50 rounded-xl px-4 py-2.5">
          <span className="text-xs text-amber-300 font-semibold flex items-center space-x-2">
            {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span>{extracting ? `Extracting styles… ${pendingHere} left in this category` : `${pendingHere} design${pendingHere === 1 ? "" : "s"} waiting for extraction`}</span>
          </span>
          {!extracting && (
            <button onClick={runExtraction} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[11px] font-bold text-white cursor-pointer flex items-center space-x-1">
              <RefreshCw className="w-3 h-3" /><span>Extract now</span>
            </button>
          )}
        </div>
      )}

      {/* Preset grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-600" /></div>
      ) : presets.length === 0 ? (
        <p className="text-sm text-slate-600 text-center py-10">
          {tab === "auto" ? "The auto-sort inbox is empty — everything dropped here has been filed on its shelf." : `Nothing in ${CATS.find((c) => c.key === tab)?.name} yet — drop your first designs above.`}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {presets.map((p) => (
            <div key={p.id} className={`border rounded-2xl overflow-hidden bg-slate-950/60 ${p.status === "failed" ? "border-rose-900/70" : p.status === "pending" ? "border-amber-900/60" : "border-slate-900"}`}>
              <div className="aspect-square bg-black/40 relative">
                {(p.mime || "").includes("pdf") ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                    <FileText className="w-10 h-10" /><span className="text-[10px] mt-1 px-2 truncate max-w-full">{p.file_name}</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt={p.file_name || ""} className="w-full h-full object-cover" loading="lazy" />
                )}
                <button onClick={() => review(p.id, { starred: !p.starred })} title="Performed well — pick this look first"
                  className={`absolute top-2 right-2 p-1.5 rounded-lg cursor-pointer ${p.starred ? "bg-amber-500 text-black" : "bg-black/60 text-slate-400 hover:text-amber-400"}`}>
                  <Star className="w-3.5 h-3.5" fill={p.starred ? "currentColor" : "none"} />
                </button>
                {p.status === "pending" && <span className="absolute bottom-2 left-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-900 text-amber-400">extracting…</span>}
                {p.status === "rejected" && <span className="absolute bottom-2 left-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-900/90 border border-slate-700 text-slate-400">rejected</span>}
                {p.auto_sorted && p.status === "approved" && <span title="The bot chose this shelf — move it if it's wrong" className="absolute bottom-2 right-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-900 text-purple-300">✨ auto</span>}
              </div>
              <div className="p-2.5 space-y-1.5">
                {p.status === "failed" ? (
                  <>
                    <p className="text-[10px] text-rose-400 leading-snug">{p.extract_error || "Extraction failed."}</p>
                    {!p.category && (
                      <select defaultValue="" onChange={(e) => e.target.value && review(p.id, { category: e.target.value, status: "pending" }).then(runExtraction)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-1.5 text-[10px] text-slate-300 cursor-pointer focus:outline-none">
                        <option value="">File it under… (then retries)</option>
                        {CATS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => review(p.id, { status: "pending" }).then(runExtraction)} className="w-full py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-bold text-white cursor-pointer">Retry extraction</button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-bold text-white truncate">{p.subject || p.file_name || "—"}</p>
                    <div className="flex flex-wrap gap-1">
                      {(p.tags || []).slice(0, 4).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">{t}</span>)}
                    </div>
                    {p.category && (
                      <div className="flex items-center gap-1.5">
                        <select value={p.category} onChange={(e) => review(p.id, { category: e.target.value })}
                          title="Move to another shelf"
                          className="bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-1 text-[10px] text-slate-300 cursor-pointer focus:outline-none">
                          {CATS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                        </select>
                        {p.suggested_category && p.suggested_category !== p.category && (
                          <button onClick={() => review(p.id, { category: p.suggested_category })}
                            title="The model would file this differently — click to accept its suggestion"
                            className="text-[9px] text-purple-400 hover:text-purple-300 cursor-pointer">
                            model: {p.suggested_category}?
                          </button>
                        )}
                      </div>
                    )}
                    <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} className="text-[10px] text-indigo-400 hover:text-indigo-300 cursor-pointer">
                      {expanded === p.id ? "▾ hide style JSON" : "▸ view style JSON"}
                    </button>
                    {expanded === p.id && (
                      <pre className="text-[9px] text-slate-400 bg-black/50 border border-slate-900 rounded-lg p-2 max-h-44 overflow-auto whitespace-pre-wrap">{JSON.stringify(p.prompt, null, 1)}</pre>
                    )}
                  </>
                )}
                <div className="flex gap-1.5 pt-0.5">
                  {p.status === "approved" && (
                    <button onClick={() => review(p.id, { status: "rejected" })} title="Keep it, but 5b won't use it" className="flex-1 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">Exclude</button>
                  )}
                  {p.status === "rejected" && (
                    <button onClick={() => review(p.id, { status: "approved" })} className="flex-1 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-900 text-[10px] font-bold text-emerald-400 cursor-pointer">Re-include</button>
                  )}
                  <button onClick={() => remove(p.id)} title="Remove from the library (Drive file stays)" className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-rose-400 cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategorySettings({ cat, onSave }: { cat: Category; onSave: (key: string, patch: Record<string, unknown>) => Promise<void> }) {
  const [primary, setPrimary] = useState(cat.font_primary || "");
  const [secondary, setSecondary] = useState(cat.font_secondary || "");
  const [notes, setNotes] = useState(cat.notes || "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-bold text-white">{cat.name} — typography mapping</h3>
      <p className="text-[11px] text-slate-500">
        The real font families this category is set in when text is composited. A client&apos;s own Brand Brain font always wins over this.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="Primary font, e.g. Playfair Display"
          className="flex-1 min-w-[180px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
        <input value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="Secondary font, e.g. Cormorant"
          className="flex-1 min-w-[180px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
        <button disabled={saving} onClick={async () => { setSaving(true); await onSave(cat.key, { font_primary: primary, font_secondary: secondary, notes }); setSaving(false); }}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for this category (optional)"
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
    </div>
  );
}
