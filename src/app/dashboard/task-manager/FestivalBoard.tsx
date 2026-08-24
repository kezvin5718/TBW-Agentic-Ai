"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtISTDate } from "@/lib/time";
import { Loader2, Plus, Check, Trash2, Undo2, Sparkles, Search, X } from "lucide-react";

interface FestivalRow { id: string; name: string; scheduled_at: string }
interface Member { id: string; name: string; role_title: string | null }
interface ClientRow { id: string; name: string }
interface FestivalTask {
  id: string;
  festival_id: string;
  client_id: string;
  tagline: string | null;
  team_member_id: string | null;
  assignee_name: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  clients?: { name: string } | null;
}

/**
 * Who is making which brand's festival creative.
 *
 * At Diwali every client needs its own post, and the question that actually
 * gets asked is "which brands are still not done" — so the board is one row per
 * client, outstanding on top, and finishing a row moves it out of the way.
 */
export default function FestivalBoard() {
  const [festivals, setFestivals] = useState<FestivalRow[]>([]);
  const [festivalId, setFestivalId] = useState("");
  const [tasks, setTasks] = useState<FestivalTask[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The festivals list is the one Campaign Planning keeps; the team's clients
  // and members come from the same place the Task Board reads them.
  useEffect(() => {
    (async () => {
      try {
        const [fRes, tRes] = await Promise.all([
          fetch("/api/festivals"),
          fetch("/api/team-tasks?status=open"),
        ]);
        if (fRes.ok) {
          const d = await fRes.json();
          const list: FestivalRow[] = d.festivals || [];
          setFestivals(list);
          // The one coming up next is the one being worked on; a festival that
          // has passed is history, and opening on it would be answering the
          // wrong question.
          const now = Date.now();
          const upcoming = list.find((f) => new Date(f.scheduled_at).getTime() >= now);
          setFestivalId((upcoming || list[list.length - 1])?.id || "");
        }
        if (tRes.ok) {
          const d = await tRes.json();
          setClients(d.clients || []);
          setTeam(d.team || []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/festival-tasks?festivalId=${id}`, { cache: "no-store" });
      if (res.ok) setTasks((await res.json()).tasks || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(festivalId); }, [festivalId, load]);

  const patch = async (id: string, fields: Record<string, unknown>) => {
    setBusy(id);
    try {
      await fetch("/api/festival-tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      await load(festivalId);
    } finally { setBusy(null); }
  };

  /** Finishing (or reopening) moves the row between sections before the round trip. */
  const setStatus = async (t: FestivalTask, status: "complete" | "pending") => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status, completed_at: status === "complete" ? new Date().toISOString() : null } : x)));
    await patch(t.id, { status });
  };

  const remove = async (id: string) => {
    if (!confirm("Take this client off the festival?")) return;
    setBusy(id);
    try {
      await fetch("/api/festival-tasks", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load(festivalId);
    } finally { setBusy(null); }
  };

  const addClients = async () => {
    if (picked.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/festival-tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ festivalId, clientIds: picked }),
      });
      const d = await res.json();
      setNotice(d.message || d.error || null);
      setPicked([]);
      setSearch("");
      setShowAdd(false);
      await load(festivalId);
    } finally { setSaving(false); }
  };

  const onFestival = useMemo(() => new Set(tasks.map((t) => t.client_id)), [tasks]);
  const byName = (a: FestivalTask, b: FestivalTask) =>
    (a.clients?.name || "").localeCompare(b.clients?.name || "");
  const pending = useMemo(() => tasks.filter((t) => t.status !== "complete").sort(byName), [tasks]);
  const complete = useMemo(() => tasks.filter((t) => t.status === "complete").sort(byName), [tasks]);

  const searchable = clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase().trim()));

  const row = (t: FestivalTask) => {
    const done = t.status === "complete";
    return (
      <div key={t.id}
        className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/60 hover:border-slate-800 transition-colors">
        <span className={`text-xs font-semibold min-w-[110px] truncate ${done ? "text-slate-500 line-through" : "text-white"}`}>
          {t.clients?.name || "Unknown client"}
        </span>

        <input
          defaultValue={t.tagline || ""}
          placeholder="Tagline for this client…"
          onBlur={(e) => { if (e.target.value.trim() !== (t.tagline || "").trim()) patch(t.id, { tagline: e.target.value }); }}
          className="flex-1 min-w-[160px] min-h-10 text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-indigo-600"
        />

        <select
          value={t.team_member_id || ""}
          disabled={!!busy}
          onChange={(e) => {
            const m = team.find((x) => x.id === e.target.value);
            patch(t.id, { teamMemberId: e.target.value || null, assigneeName: m?.name || null });
          }}
          className="min-h-10 text-[10px] font-bold bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none"
        >
          <option value="">Assign to…</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : (
          <>
            {done ? (
              <button onClick={() => setStatus(t, "pending")} title="Put this back on the list"
                className="flex items-center gap-1 min-h-10 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer">
                <Undo2 className="w-3 h-3" /><span>Reopen</span>
              </button>
            ) : (
              <button onClick={() => setStatus(t, "complete")} title="Mark this client's creative done"
                className="flex items-center gap-1 min-h-10 px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-900 text-[10px] font-bold text-emerald-300 hover:bg-emerald-900/40 cursor-pointer">
                <Check className="w-3 h-3" /><span>Done</span>
              </button>
            )}
            <button onClick={() => remove(t.id)} title="Remove from this festival"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-700 hover:text-rose-400 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={festivalId} onChange={(e) => setFestivalId(e.target.value)}
          className="min-h-10 text-[11px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2.5 text-slate-200 cursor-pointer focus:outline-none">
          {festivals.length === 0 && <option value="">No festivals yet</option>}
          {festivals.map((f) => (
            <option key={f.id} value={f.id}>{f.name} · {fmtISTDate(f.scheduled_at)}</option>
          ))}
        </select>

        <button onClick={() => setShowAdd((v) => !v)} disabled={!festivalId}
          className="flex items-center gap-1.5 min-h-10 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /><span>Add clients</span>
        </button>

        <span className="text-[10px] text-slate-600 font-mono ml-auto">{tasks.length} client(s) on this festival</span>
      </div>

      {notice && <p className="text-[11px] text-slate-400">{notice}</p>}

      {showAdd && (
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…"
              className="flex-1 min-w-0 min-h-10 text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder:text-slate-700 focus:outline-none focus:border-indigo-600" />
            <button onClick={() => setShowAdd(false)} className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-600 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
            {searchable.map((c) => {
              const already = onFestival.has(c.id);
              const on = picked.includes(c.id);
              return (
                <button key={c.id} disabled={already}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  className={`min-h-10 px-3 py-2 rounded-lg text-[11px] font-bold border cursor-pointer disabled:cursor-not-allowed ${
                    already ? "bg-slate-900/40 border-slate-900 text-slate-700"
                      : on ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                  }`}>
                  {c.name}{already && " ✓"}
                </button>
              );
            })}
            {searchable.length === 0 && <p className="text-[11px] text-slate-600 py-2">No client matches that.</p>}
          </div>

          <button onClick={addClients} disabled={saving || picked.length === 0}
            className="flex items-center gap-1.5 min-h-10 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{picked.length ? `Add ${picked.length} client${picked.length === 1 ? "" : "s"}` : "Add clients"}</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : !festivalId ? (
        <p className="text-xs text-slate-600 py-16 text-center">No festivals are on the calendar yet — add one under Festivals first.</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-slate-600 py-16 text-center">
          No clients on this festival yet. Use <span className="text-slate-300 font-semibold">Add clients</span> to build the list.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[var(--yellow)]" />
              <span>Pending</span>
              <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{pending.length}</span>
            </h3>
            {pending.length === 0
              ? <p className="text-[11px] text-emerald-400">Every client on this festival is done.</p>
              : <div className="space-y-1.5">{pending.map(row)}</div>}
          </div>

          {complete.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Complete</span>
                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{complete.length}</span>
              </h3>
              <div className="space-y-1.5">{complete.map(row)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
