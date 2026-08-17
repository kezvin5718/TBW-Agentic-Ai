"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtIST, istToday } from "@/lib/time";
import { Sparkles, Loader2, Plus, Trash2, Pencil, Check, X, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";

interface Festival {
  id: string;
  name: string;
  scheduled_at: string;
  notes: string | null;
  created_at: string;
  profiles?: { name: string } | null;
}

/**
 * The single list of festivals and the time each one posts at.
 *
 * Everything that needs a festival name reads it from here, so the agency keeps
 * one list rather than two that quietly drift apart.
 */
export default function FestivalsPage() {
  const [rows, setRows] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState("");
  const [date, setDate] = useState(istToday());
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");

  const [editing, setEditing] = useState<{ id: string; name: string; date: string; time: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/festivals");
      const data = await res.json();
      if (res.ok) setRows(data.festivals || []);
    } catch { /* the list simply stays as it was */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try { el.showPicker?.(); } catch { /* needs direct interaction — fine */ }
  };

  const add = async () => {
    setBusy("new");
    setNotice(null);
    try {
      const res = await fetch("/api/festivals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, date, time, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add it");
      setName(""); setNotes("");
      setNotice({ ok: true, text: `"${data.festival.name}" added.` });
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not add it" });
    } finally { setBusy(null); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(editing.id);
    try {
      const res = await fetch("/api/festivals", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setEditing(null);
      setNotice({ ok: true, text: "Saved. Stories already scheduled keep their original time." });
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally { setBusy(null); }
  };

  const remove = async (f: Festival) => {
    if (!window.confirm(`Remove "${f.name}"?\n\nCreatives already uploaded against it keep their files — they just stop being linked to a festival.`)) return;
    setBusy(f.id);
    try {
      const res = await fetch("/api/festivals", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: f.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove it");
      setNotice({ ok: true, text: data.note || `"${f.name}" removed.` });
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not remove it" });
    } finally { setBusy(null); }
  };

  const canAdd = !!name.trim() && !!date && !!time && busy !== "new";
  const now = Date.now();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Sparkles className="w-6 h-6 text-[var(--yellow)]" /><span>Festivals</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          The one list of festivals and the time each posts at. A festival story uploaded in Content Hub is scheduled automatically at the time set here — nobody picks a date per upload.
        </p>
      </div>

      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Add */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Add a festival</label>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[190px]">
            <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Date</span>
            <input type="date" value={date} onClick={openPicker} onChange={(e) => setDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Time</span>
            <input type="time" value={time} onClick={openPicker} onChange={(e) => setTime(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-500" />
          </div>
          <button onClick={add} disabled={!canAdd}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${canAdd ? "bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
            {busy === "new" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span>Add</span>
          </button>
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note — e.g. auspicious window 6:00–9:45 AM"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
      </div>

      {/* List */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
          Festivals <span className="text-slate-600 normal-case font-medium">({rows.length})</span>
        </label>

        {loading ? (
          <p className="text-xs text-slate-600 py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-600 py-6 text-center">Nothing yet — add the first festival above.</p>
        ) : (
          rows.map((f) => {
            const past = new Date(f.scheduled_at).getTime() < now;
            const isEditing = editing?.id === f.id;
            return (
              <div key={f.id} className={`flex items-center gap-3 flex-wrap border rounded-xl p-3 ${past ? "border-slate-900 bg-slate-950/40 opacity-60" : "border-slate-900 bg-slate-950/70"}`}>
                {isEditing ? (
                  <>
                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="flex-1 min-w-[160px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                    <input type="date" value={editing.date} onClick={openPicker} onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none" />
                    <input type="time" value={editing.time} onClick={openPicker} onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white cursor-pointer [color-scheme:dark] focus:outline-none" />
                    <button onClick={saveEdit} disabled={busy === f.id} title="Save"
                      className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50">
                      {busy === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => setEditing(null)} title="Cancel"
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">
                        {f.name}
                        {past && <span className="ml-2 text-[9px] font-black uppercase text-slate-500">past</span>}
                      </p>
                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <CalendarClock className="w-3 h-3" />
                        {fmtIST(f.scheduled_at, { weekday: "short" })} IST
                        {f.profiles?.name ? ` · added by ${f.profiles.name}` : ""}
                      </p>
                      {f.notes && <p className="text-[10px] text-slate-600 mt-0.5 truncate">{f.notes}</p>}
                    </div>
                    <button
                      onClick={() => {
                        const d = new Date(f.scheduled_at);
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setEditing({
                          id: f.id,
                          name: f.name,
                          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                          time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
                        });
                      }}
                      title="Edit name or timing"
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-600 text-slate-300 cursor-pointer">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(f)} disabled={busy === f.id} title="Remove"
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-rose-700 text-slate-400 hover:text-rose-400 cursor-pointer disabled:opacity-50">
                      {busy === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
        <p className="text-[10px] text-slate-600 pt-1">
          Changing a time affects stories scheduled from now on. Anything already queued at RecurPost keeps its original time — their API has no way to move a post.
        </p>
      </div>
    </div>
  );
}
