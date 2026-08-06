"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, Loader2, Check, X, ChevronDown, ChevronRight, AlertTriangle, Sparkles } from "lucide-react";
import { fmtIST } from "@/lib/time";

interface Msg { id: string; sender_name: string | null; message_text: string | null; received_at: string }
interface Draft {
  id: string;
  group_name: string | null;
  client_id: string | null;
  client_uncertain: boolean;
  title: string;
  description: string | null;
  task_type: string;
  priority: string;
  suggested_assignee: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  clients?: { name: string } | null;
  messages: Msg[];
}
interface ClientRow { id: string; name: string }
interface Staff { id: string; name: string | null }

const PRIORITIES = ["low", "medium", "high", "urgent"];
const TASK_TYPES = ["copy", "image", "video", "ads", "design", "video_edit", "ai_video", "script", "planning", "packaging", "print", "other"];
const PRI: Record<string, string> = {
  urgent: "bg-rose-950/40 border-rose-900 text-rose-400",
  high: "bg-orange-950/40 border-orange-900 text-orange-400",
  medium: "bg-amber-950/40 border-amber-900 text-amber-400",
  low: "bg-slate-900 border-slate-800 text-slate-500",
};

/**
 * Drafts the bot framed from a burst of WhatsApp messages. Nothing here has
 * reached the task board yet — the approver sees the original conversation
 * next to the drafted task, edits anything that's off, then accepts.
 */
export default function TaskDrafts({ clients, staff, onApproved }: { clients: ClientRow[]; staff: Staff[]; onApproved?: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Draft> & { assignee?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp-inbox/drafts?status=pending", { cache: "no-store" });
      if (res.ok) setDrafts((await res.json()).drafts || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runBot = async () => {
    setRunning(true);
    setNote(null);
    try {
      const res = await fetch("/api/whatsapp-inbox/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not run the bot");
      setNote(
        data.drafted > 0
          ? `Framed ${data.drafted} task(s) from ${data.clusters} conversation(s).`
          : data.skipped > 0
          ? `Nothing ready yet — ${data.skipped} conversation(s) still active. The bot waits 2 minutes of silence before reading.`
          : "No new conversations to read."
      );
      await load();
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "Could not run the bot");
    } finally { setRunning(false); }
  };

  const patch = (id: string, key: string, value: string) =>
    setEdits((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  const val = (d: Draft, key: keyof Draft | "assignee"): string => {
    const e = edits[d.id] as Record<string, unknown> | undefined;
    if (e && e[key] !== undefined) return String(e[key] ?? "");
    if (key === "assignee") return d.suggested_assignee || "";
    return String((d as unknown as Record<string, unknown>)[key] ?? "");
  };

  const decide = async (d: Draft, action: "approve" | "reject") => {
    setBusy(d.id);
    setNote(null);
    try {
      const e = edits[d.id] || {};
      const res = await fetch("/api/whatsapp-inbox/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: d.id,
          action,
          ...(action === "approve" ? {
            title: val(d, "title"),
            description: val(d, "description"),
            clientId: e.client_id !== undefined ? e.client_id || null : d.client_id,
            taskType: val(d, "task_type"),
            priority: val(d, "priority"),
            assignee: val(d, "assignee"),
          } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
      setNote(action === "approve" ? `"${val(d, "title")}" is on the task board.` : "Draft dismissed.");
      if (action === "approve") onApproved?.();
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="bg-slate-950/40 border border-emerald-900/40 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-400" />
            <span>Tasks drafted from WhatsApp</span>
            {drafts.length > 0 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900 text-emerald-400">
                {drafts.length} waiting
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 max-w-2xl">
            The bot reads each client group as a conversation, not message by message, and waits 2 minutes of
            silence before framing the task. Check it, fix anything wrong, then approve — nothing reaches the
            task board until you do.
          </p>
        </div>
        <button onClick={runBot} disabled={running}
          className="px-4 py-2 rounded-xl font-bold text-[11px] uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-emerald-600 text-white flex items-center gap-2 cursor-pointer disabled:opacity-60">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>{running ? "Reading…" : "Read now"}</span>
        </button>
      </div>

      {note && <p className="text-[11px] text-emerald-300 bg-emerald-950/20 border border-emerald-900/50 rounded-lg px-3 py-2">{note}</p>}

      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 text-emerald-500 animate-spin" /></div>
      ) : drafts.length === 0 ? (
        <p className="text-[11px] text-slate-600 py-6 text-center">
          No drafts waiting. New client requests appear here a couple of minutes after the conversation ends.
        </p>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => {
            const expanded = open === d.id;
            return (
              <div key={d.id} className="bg-slate-950/70 border border-slate-900 rounded-xl p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <input
                      value={val(d, "title")}
                      onChange={(e) => patch(d.id, "title", e.target.value)}
                      className="w-full bg-transparent text-sm font-bold text-white focus:outline-none focus:bg-slate-900/60 rounded px-1 -mx-1"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {d.group_name || "group"} · {d.messages.length} message(s) · {fmtIST(d.first_message_at)}
                    </p>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${PRI[val(d, "priority")] || PRI.low}`}>
                    {val(d, "priority")}
                  </span>
                </div>

                <textarea
                  value={val(d, "description")}
                  onChange={(e) => patch(d.id, "description", e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg px-2.5 py-2 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-700"
                />

                {d.client_uncertain && (
                  <p className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Brand not certain — please confirm which client this is.
                  </p>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <select
                    value={edits[d.id]?.client_id !== undefined ? String(edits[d.id]?.client_id ?? "") : d.client_id || ""}
                    onChange={(e) => patch(d.id, "client_id", e.target.value)}
                    className={`text-[11px] rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none border ${
                      d.client_uncertain && !(edits[d.id]?.client_id) ? "bg-amber-950/30 border-amber-800" : "bg-slate-950 border-slate-800"
                    }`}
                  >
                    <option value="">— client —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <select value={val(d, "assignee")} onChange={(e) => patch(d.id, "assignee", e.target.value)}
                    className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                    <option value="">— unassigned —</option>
                    {staff.map((s) => <option key={s.id} value={s.name || ""}>{s.name}</option>)}
                    {val(d, "assignee") && !staff.some((s) => s.name === val(d, "assignee")) && (
                      <option value={val(d, "assignee")}>{val(d, "assignee")}</option>
                    )}
                  </select>

                  <select value={val(d, "task_type")} onChange={(e) => patch(d.id, "task_type", e.target.value)}
                    className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                    {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                  </select>

                  <select value={val(d, "priority")} onChange={(e) => patch(d.id, "priority", e.target.value)}
                    className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white cursor-pointer focus:outline-none">
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <button onClick={() => setOpen(expanded ? null : d.id)}
                  className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer">
                  {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  What the bot read ({d.messages.length})
                </button>
                {expanded && (
                  <div className="bg-slate-950 border border-slate-900 rounded-lg p-2.5 space-y-1.5">
                    {d.messages.map((m) => (
                      <p key={m.id} className="text-[11px] text-slate-400">
                        <span className="font-bold text-slate-300">{m.sender_name || "someone"}:</span> {m.message_text}
                        <span className="text-slate-700 ml-1.5">{fmtIST(m.received_at, { day: undefined, month: undefined, year: undefined })}</span>
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-0.5">
                  <button disabled={busy === d.id} onClick={() => decide(d, "approve")}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50">
                    {busy === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>Approve → task board</span>
                  </button>
                  <button disabled={busy === d.id} onClick={() => decide(d, "reject")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 text-[11px] font-bold cursor-pointer disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /><span>Not a task</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
