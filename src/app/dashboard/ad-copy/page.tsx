"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles, Loader2, UploadCloud, CheckCircle2, AlertTriangle, Copy, Check, X, FolderUp, Images,
} from "lucide-react";

interface ClientRow { id: string; name: string }
interface HubUpload {
  id: string; client_id: string; file_url: string; file_name: string | null;
  media_type: string; content_type: string; status: string;
  clients?: { name: string } | null;
}
interface CardItem { key: string; url: string; name: string; hubId?: string }
interface OutCard { url: string; name: string; headline: string; trimmed: boolean; imageRead: boolean }

/** Meta's carousel/catalogue ad tops out at 10 cards. */
const MAX_IMAGES = 10;

export default function AdCopyPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<CardItem[]>([]);
  const [hubUploads, setHubUploads] = useState<HubUpload[]>([]);
  const [aiModel, setAiModel] = useState<"chatgpt" | "gemini">("chatgpt");

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [primaryText, setPrimaryText] = useState("");
  const [cards, setCards] = useState<OutCard[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadHub = useCallback(async () => {
    try {
      const res = await fetch("/api/content-hub");
      if (!res.ok) return;
      const data = await res.json();
      // Carousel cards are stills — a reel can't be a catalogue card.
      setHubUploads(((data.uploads || []) as HubUpload[]).filter((u) => u.media_type === "image"));
    } catch { /* the upload path still works */ }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("clients").select("id, name").is("archived_at", null).order("name");
      setClients((data || []) as ClientRow[]);
    })();
    loadHub();
  }, [loadHub]);

  const room = MAX_IMAGES - items.length;
  const hubForClient = hubUploads.filter((u) => !clientId || u.client_id === clientId);

  const addItems = (incoming: CardItem[]) => {
    setItems((prev) => {
      const space = MAX_IMAGES - prev.length;
      if (space <= 0) return prev;
      // Same picture twice would produce two cards with the same headline.
      const fresh = incoming.filter((i) => !prev.some((p) => p.url === i.url)).slice(0, space);
      return [...prev, ...fresh];
    });
  };

  const uploadFiles = async (files: File[]) => {
    if (room <= 0) {
      setNotice({ ok: false, text: `Already at ${MAX_IMAGES} cards — remove one first.` });
      return;
    }
    const list = files.slice(0, room);
    setUploading(true);
    setBatch({ done: 0, total: list.length });
    setNotice(null);
    const done: CardItem[] = [];
    const failed: string[] = [];
    let hardStop = "";
    const clientName = clients.find((c) => c.id === clientId)?.name || "";
    for (let i = 0; i < list.length; i++) {
      try {
        // Straight to Google Drive — these are the real ad creatives the team
        // uploads to Ads Manager by hand, and Supabase Storage has no room.
        const fd = new FormData();
        fd.append("file", list[i]);
        if (clientName) fd.append("clientName", clientName);
        const res = await fetch("/api/ad-copy/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          // Drive being disconnected fails every remaining file the same way —
          // say it once instead of listing ten identical failures.
          if (res.status === 400 && /not connected/i.test(data.error || "")) { hardStop = data.error; break; }
          throw new Error(data.error || "Upload failed");
        }
        done.push({ key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`, url: data.url, name: data.name });
      } catch {
        failed.push(list[i].name);
      }
      setBatch({ done: i + 1, total: list.length });
      setUploadPct(Math.round(((i + 1) / list.length) * 100));
    }
    setUploading(false);
    setBatch(null);
    setUploadPct(0);
    addItems(done);
    if (hardStop) setNotice({ ok: false, text: hardStop });
    else if (failed.length) setNotice({ ok: false, text: `${done.length} uploaded to Drive, ${failed.length} failed: ${failed.join(", ")}` });
    else if (done.length) setNotice({ ok: true, text: `${done.length} image(s) saved to Google Drive.` });
  };

  const toggleHub = (u: HubUpload) => {
    const existing = items.find((i) => i.hubId === u.id);
    if (existing) { setItems((prev) => prev.filter((i) => i.hubId !== u.id)); return; }
    if (room <= 0) { setNotice({ ok: false, text: `Already at ${MAX_IMAGES} cards — remove one first.` }); return; }
    addItems([{ key: `hub-${u.id}`, url: u.file_url, name: u.file_name || "content hub file", hubId: u.id }]);
  };

  const generate = async () => {
    setGenerating(true);
    setNotice(null);
    setWarning(null);
    try {
      const res = await fetch("/api/ad-copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, model: aiModel, images: items.map((i) => ({ url: i.url, name: i.name })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setPrimaryText(data.primaryText || "");
      setCards((data.cards || []) as OutCard[]);
      setWarning(data.warning || null);
      setNotice({ ok: true, text: `Copy generated for ${(data.cards || []).length} card(s) ✅` });
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Generation failed" });
    } finally { setGenerating(false); }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setNotice({ ok: false, text: "The browser blocked clipboard access — select the text and copy it manually." });
    }
  };

  const canGenerate = !!clientId && items.length > 0 && !generating && !uploading;

  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Sparkles className="w-6 h-6 text-[var(--yellow)]" /><span>Catalogue Ad Copy</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload up to {MAX_IMAGES} product images, pick the client, and generate the Primary text plus a short headline for every card — read off the images themselves and written in that brand&apos;s voice. Copy each field straight into Meta Ads Manager.
        </p>
        <p className="text-[11px] text-slate-600 mt-1.5">
          This writes copy only. Nothing here creates a campaign, ad set or ad, and no budget is ever touched.
        </p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="whitespace-pre-wrap">{notice.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
        {/* ---------------- LEFT: what goes in ---------------- */}
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Client / Brand</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Model</label>
              <select value={aiModel} onChange={(e) => setAiModel(e.target.value as "chatgpt" | "gemini")}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="chatgpt">ChatGPT (GPT-4o)</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
          </div>

          {/* Upload */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Images <span className="text-slate-600 normal-case font-medium">({items.length} of {MAX_IMAGES} cards)</span>
            </label>
            <div
              onClick={() => !uploading && room > 0 && fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = Array.from(e.dataTransfer.files || []).filter((x) => x.type.startsWith("image/"));
                if (f.length && !uploading) uploadFiles(f);
              }}
              className={`border border-dashed rounded-xl p-5 text-center transition-colors ${room > 0 && !uploading ? "border-slate-800 hover:border-indigo-500 cursor-pointer" : "border-slate-900 opacity-50 cursor-not-allowed"}`}
            >
              {batch ? (
                <div className="space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--yellow)]" />
                  <p className="text-[11px] font-bold text-white">Uploading {batch.done} of {batch.total}…</p>
                  <div className="h-1 bg-slate-900 rounded-full overflow-hidden max-w-[200px] mx-auto">
                    <div className="h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${uploadPct}%` }} />
                  </div>
                </div>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 mx-auto mb-1.5 text-[var(--yellow)]" />
                  <p className="text-xs font-bold text-white">
                    {room > 0 ? "Drop product images here, or click to browse" : `All ${MAX_IMAGES} cards filled`}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">Pick several at once — room for {room} more.</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" multiple accept="image/*" className="hidden"
              onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) uploadFiles(f); e.target.value = ""; }} />
          </div>

          {/* Content Hub */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <FolderUp className="w-3.5 h-3.5" />
              <span>From Content Hub <span className="text-slate-600 normal-case font-medium">— tick what designers already delivered</span></span>
            </label>
            {hubForClient.length === 0 ? (
              <p className="text-[11px] text-slate-600 py-2">
                {clientId ? "No image uploads waiting for this client." : "Select a client to see their delivered images."}
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[220px] overflow-y-auto pr-1">
                {hubForClient.map((u) => {
                  const picked = items.some((i) => i.hubId === u.id);
                  return (
                    <button key={u.id} type="button" onClick={() => toggleHub(u)} title={u.file_name || "image"}
                      className={`relative rounded-lg overflow-hidden border-2 aspect-square transition-all cursor-pointer ${picked ? "border-[var(--yellow)]" : "border-slate-800 hover:border-indigo-500"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.file_url} alt="" className="w-full h-full object-cover" />
                      {picked && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[var(--yellow)] text-black text-[9px] font-black flex items-center justify-center">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chosen cards */}
          {items.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Cards in this ad</label>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {items.map((it, i) => (
                  <div key={it.key} className="relative rounded-lg overflow-hidden border border-slate-800 aspect-square bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt={it.name} className="w-full h-full object-cover" />
                    <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--yellow)] text-black text-[9px] font-black flex items-center justify-center">{i + 1}</span>
                    <button onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))} title="Remove this card"
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-slate-300 hover:text-rose-400 flex items-center justify-center cursor-pointer">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => setItems([])} className="mt-2 text-[10px] font-bold text-slate-500 hover:text-rose-400 cursor-pointer">Clear all</button>
            </div>
          )}

          <button onClick={generate} disabled={!canGenerate}
            className={`w-full px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all ${canGenerate ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{generating ? "Reading the images and writing…" : `Generate copy for ${items.length} card(s)`}</span>
          </button>
          {generating && <p className="text-[10px] text-slate-500 text-center">Every image is read first, so this takes a few seconds.</p>}
        </div>

        {/* ---------------- RIGHT: what comes out ---------------- */}
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Images className="w-4 h-4 text-[var(--yellow)]" /><span>Generated copy</span>
          </h3>

          {warning && (
            <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-2.5 text-[11px] text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{warning}</span>
            </div>
          )}

          {!primaryText && cards.length === 0 ? (
            <p className="text-xs text-slate-600 py-8 text-center">
              Nothing generated yet — add your images on the left and press Generate.
            </p>
          ) : (
            <>
              {/* Primary text — one per ad */}
              <div className="border border-slate-900 rounded-xl bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Primary text <span className="text-slate-600 normal-case font-medium">— one for the whole ad</span></span>
                  <button onClick={() => copy(primaryText, "primary")}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[10px] font-bold text-slate-300 hover:text-white cursor-pointer">
                    {copied === "primary" ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy</span></>}
                  </button>
                </div>
                <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{primaryText}</pre>
              </div>

              {/* One headline per card */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Headlines <span className="text-slate-600 normal-case font-medium">— one per card, in order</span></span>
                {cards.map((c, i) => (
                  <div key={`${c.url}-${i}`} className="flex items-center gap-2.5 bg-slate-950/60 border border-slate-900 rounded-lg p-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--yellow)] text-black text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="w-10 h-10 rounded overflow-hidden border border-slate-800 bg-slate-900 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{c.headline || <span className="text-rose-400">(nothing generated)</span>}</p>
                      <p className="text-[10px] text-slate-600 truncate">
                        {c.name || "image"}
                        {c.trimmed && <span className="text-amber-400 font-bold"> · shortened to fit</span>}
                        {!c.imageRead && <span className="text-amber-400 font-bold"> · image not read</span>}
                      </p>
                    </div>
                    <button onClick={() => copy(c.headline, `h-${i}`)} disabled={!c.headline}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 text-[10px] font-bold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40 shrink-0">
                      {copied === `h-${i}` ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy</span></>}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
