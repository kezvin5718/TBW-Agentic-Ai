"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadDirect } from "@/lib/direct-upload";
import Avatar from "../Avatar";
import { fmtIST } from "@/lib/time";
import TaskDrafts from "../whatsapp-inbox/TaskDrafts";
import {
  Phone, UploadCloud, Loader2, CheckCircle2, AlertTriangle, Mic, Square,
  Trash2, RotateCcw, FileText, ChevronRight,
} from "lucide-react";

interface CallRow {
  id: string;
  title: string;
  audio_url: string;
  file_name: string | null;
  size_mb: number | null;
  duration_seconds: number | null;
  transcript: string | null;
  status: string;
  error: string | null;
  drafts_created: number;
  created_at: string;
  clients?: { name: string } | null;
  profiles?: { name: string; avatar_url?: string | null; designation?: string | null } | null;
}

const mmss = (s: number | null) => {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
};

export default function CallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string | null }[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);
  const [draftsKey, setDraftsKey] = useState(0);

  // New call being added
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [stage, setStage] = useState<"" | "uploading" | "thinking">("");
  const fileRef = useRef<HTMLInputElement>(null);

  // In-browser recording, for calls on speaker and meetings in the room
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calls", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCalls(data.calls || []);
        setReady(data.transcriptionReady !== false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const supabase = createClient();
      const [{ data: cl }, { data: st }] = await Promise.all([
        supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
        supabase.from("profiles").select("id, name").in("role", ["founder", "employee"]),
      ]);
      setClients(cl || []);
      setStaff(st || []);
    })();
  }, [load]);

  const send = async (file: File) => {
    setNotice(null);
    setStage("uploading");
    setUploadPct(0);
    try {
      const up = await uploadDirect(file, "calls", setUploadPct);
      setStage("thinking");
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: up.url,
          title: title.trim() || file.name,
          fileName: file.name,
          sizeMb: up.sizeMb,
          clientId: clientId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process the call");
      setNotice({ ok: data.success, text: data.message || "Done." });
      setTitle("");
      setClientId("");
      setDraftsKey((k) => k + 1);
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setStage("");
      setUploadPct(0);
    }
  };

  const startRecording = async () => {
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        send(new File([blob], `recording ${stamp}.webm`, { type: blob.type }));
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setNotice({ ok: false, text: "Couldn't reach the microphone — allow mic access for this site and try again." });
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (tickRef.current) clearInterval(tickRef.current);
  };

  const retry = async (c: CallRow) => {
    setBusy(c.id);
    setNotice(null);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id: c.id }),
      });
      const data = await res.json();
      setNotice({ ok: !!data.success, text: data.message || data.error || "Done." });
      setDraftsKey((k) => k + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: CallRow) => {
    if (!confirm(`Delete "${c.title}"? Tasks you already approved stay on the board; anything still waiting is discarded.`)) return;
    setBusy(c.id);
    try {
      const res = await fetch("/api/calls", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      setDraftsKey((k) => k + 1);
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Delete failed" });
    } finally {
      setBusy(null);
    }
  };

  const workingOnIt = stage !== "";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Phone className="w-6 h-6 text-[var(--yellow)]" /><span>Call Notes</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Record a meeting or drop in a call recording. It gets transcribed, the commitments are pulled out as tasks,
          and nothing reaches the board until you approve it.
        </p>
      </div>

      {!ready && (
        <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Transcription isn&apos;t switched on — add <span className="font-mono">OPENAI_API_KEY</span> to the server{" "}
            <span className="font-mono">.env</span> and redeploy. Until then nothing here will run.
          </span>
        </div>
      )}

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start gap-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Add a call */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">What was this call?</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={workingOnIt || recording}
              placeholder="e.g. Taraash — Diwali campaign review"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Client <span className="normal-case font-medium text-slate-600">— optional, helps it guess right</span>
            </label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={workingOnIt || recording}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50">
              <option value="">— Work it out from the call —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {workingOnIt ? (
          <div className="border border-dashed border-indigo-900/60 rounded-xl p-5 text-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-[var(--yellow)]" />
            {stage === "uploading" ? (
              <>
                <div className="h-1 bg-slate-900 rounded-full overflow-hidden max-w-[220px] mx-auto">
                  <div className="h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${uploadPct}%` }} />
                </div>
                <p className="text-xs text-slate-400">Uploading — {uploadPct}%</p>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Listening to the call and pulling out the tasks. Roughly a minute for every half hour of audio —
                keep this tab open until it finishes.
              </p>
            )}
          </div>
        ) : recording ? (
          <div className="border border-rose-900/60 bg-rose-950/10 rounded-xl p-5 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-rose-300">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-sm font-bold tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
            </div>
            <p className="text-[11px] text-slate-500">Recording this device&apos;s microphone. Put a phone call on speaker for it to be picked up.</p>
            <button onClick={stopRecording}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer">
              <Square className="w-3.5 h-3.5" /> Stop &amp; process
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={startRecording} disabled={!ready}
              className="border border-dashed border-slate-800 hover:border-rose-600 rounded-xl p-5 text-center cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Mic className="w-6 h-6 mx-auto mb-1.5 text-rose-400" />
              <p className="text-xs font-bold text-slate-300">Record now</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Meetings in the room, or a call on speaker</p>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={!ready}
              className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <UploadCloud className="w-6 h-6 mx-auto mb-1.5 text-indigo-400" />
              <p className="text-xs font-bold text-slate-300">Upload a recording</p>
              <p className="text-[10px] text-slate-600 mt-0.5">From your phone recorder, Zoom or Meet</p>
            </button>
            <input ref={fileRef} type="file" className="hidden"
              accept="audio/*,video/mp4,.mp3,.m4a,.wav,.ogg,.opus,.webm,.aac,.amr,.mp4"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
          </div>
        )}
      </div>

      {/* Tasks waiting on approval — the same review screen the WhatsApp bot uses */}
      <TaskDrafts key={draftsKey} clients={clients} staff={staff} onApproved={load} />

      {/* Past calls */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-[var(--yellow)]" /><span>Calls</span>
          {calls.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400">{calls.length}</span>}
        </h3>

        {loading ? (
          <p className="text-xs text-slate-600 py-3 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></p>
        ) : calls.length === 0 ? (
          <p className="text-xs text-slate-600 py-3 text-center">No calls yet — record one above, or upload a recording.</p>
        ) : (
          <div className="space-y-2">
            {calls.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-900 bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{c.title}</p>
                    <p className="text-[10px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                      <Avatar name={c.profiles?.name} url={c.profiles?.avatar_url} size={14} rounded="rounded-full" />
                      <span>{c.profiles?.name || "—"}</span>
                      <span>· {fmtIST(c.created_at)} IST</span>
                      {c.clients?.name && <span>· <span className="text-slate-300 font-bold">{c.clients.name}</span></span>}
                      {c.duration_seconds ? <span>· {mmss(c.duration_seconds)}</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                      c.status === "transcribed" ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
                      : c.status === "failed" ? "bg-rose-950/40 border-rose-900 text-rose-400"
                      : "bg-amber-950/40 border-amber-900 text-amber-400"}`}>
                      {c.status === "transcribed" ? `${c.drafts_created} TASK${c.drafts_created === 1 ? "" : "S"}` : c.status.toUpperCase()}
                    </span>
                    {c.status === "failed" && (
                      <button disabled={busy === c.id} onClick={() => retry(c)} title="Try again"
                        className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer disabled:opacity-50">
                        {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button disabled={busy === c.id} onClick={() => remove(c)} title="Delete"
                      className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-500 hover:text-rose-400 cursor-pointer disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {c.error && <p className="text-[10px] text-rose-400 break-words">{c.error}</p>}

                {c.transcript && (
                  <div>
                    <button onClick={() => setOpenTranscript(openTranscript === c.id ? null : c.id)}
                      className="text-[10px] font-bold text-slate-500 hover:text-indigo-400 flex items-center gap-1 cursor-pointer">
                      <ChevronRight className={`w-3 h-3 transition-transform ${openTranscript === c.id ? "rotate-90" : ""}`} />
                      Transcript
                    </button>
                    {openTranscript === c.id && (
                      <p className="mt-2 text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto bg-slate-950 border border-slate-900 rounded-lg p-3">
                        {c.transcript}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
