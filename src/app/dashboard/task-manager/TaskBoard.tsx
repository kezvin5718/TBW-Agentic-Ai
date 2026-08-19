"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Avatar from "../Avatar";
import {
  Loader2, Plus, X, Check, Users, LayoutGrid, Rows3,
  Calendar, AlertTriangle, MessageSquare, FileSpreadsheet, Trash2,
} from "lucide-react";

interface Task {
  id: string;
  title: string | null;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  deadline: string;
  source: string;
  assignee_name: string | null;
  assignee_id: string | null;
  client_id: string | null;
  created_at: string;
  completed_at: string | null;
  clients?: { name: string } | null;
}
interface Member { id: string; name: string; role_title: string | null; profile_id: string | null; avatar_url: string | null }
interface ClientRow { id: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  design: "Design", video_edit: "Video Edit", ai_video: "AI Video", script: "Script",
  planning: "Planning", packaging: "Packaging", print: "Print", copy: "Copy",
  image: "Image", video: "Video", ads: "Ads", other: "Task",
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-rose-400", medium: "bg-amber-400", low: "bg-slate-600",
};
const STATUS_STYLE: Record<string, string> = {
  todo: "bg-slate-900 border-slate-800 text-slate-400",
  in_progress: "bg-blue-950/40 border-blue-900 text-blue-400",
  review: "bg-amber-950/40 border-amber-900 text-amber-400",
  done: "bg-emerald-950/40 border-emerald-900 text-emerald-400",
};

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [view, setView] = useState<"board" | "list">("board");
  const [filterMember, setFilterMember] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", clientId: "", assigneeName: "", type: "design", priority: "medium", deadline: "" });
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team-tasks?status=${status}`);
      if (res.ok) {
        const d = await res.json();
        setTasks(d.tasks || []);
        setTeam(d.team || []);
        setClients(d.clients || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(tab); }, [tab, fetchAll]);

  const patch = async (id: string, fields: Record<string, unknown>) => {
    setBusy(id);
    try {
      await fetch("/api/team-tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
      await fetchAll(tab);
    } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    setBusy(id);
    try {
      await fetch("/api/team-tasks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      await fetchAll(tab);
    } finally { setBusy(null); }
  };

  const addTask = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/team-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setForm({ title: "", clientId: "", assigneeName: "", type: "design", priority: "medium", deadline: "" });
      setShowAdd(false);
      await fetchAll(tab);
    } finally { setSaving(false); }
  };

  const filtered = useMemo(() => tasks.filter((t) =>
    (!filterMember || (filterMember === "unassigned" ? !t.assignee_name : (t.assignee_name || "").toLowerCase() === filterMember.toLowerCase())) &&
    (!filterClient || t.client_id === filterClient)
  ), [tasks, filterMember, filterClient]);

  const now = Date.now();
  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done");
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return {
      open: open.length,
      overdue: open.filter((t) => new Date(t.deadline).getTime() < startToday.getTime()).length,
      dueToday: open.filter((t) => { const d = new Date(t.deadline).getTime(); return d >= startToday.getTime() && d <= today.getTime(); }).length,
      review: open.filter((t) => t.status === "review").length,
    };
  }, [tasks]);

  // Board columns: members that have tasks in the current filter, plus Unassigned
  const columns = useMemo(() => {
    const names = team.map((m) => m.name);
    const extra = [...new Set(filtered.map((t) => t.assignee_name).filter((n): n is string => !!n && !names.some((x) => x.toLowerCase() === n.toLowerCase())))];
    const all = [...names, ...extra];
    const cols = all
      .map((name) => ({ name, member: team.find((m) => m.name === name), items: filtered.filter((t) => (t.assignee_name || "").toLowerCase() === name.toLowerCase()) }))
      .filter((c) => c.items.length > 0);
    const unassigned = filtered.filter((t) => !t.assignee_name);
    if (unassigned.length > 0) cols.push({ name: "Unassigned", member: undefined, items: unassigned });
    return cols;
  }, [filtered, team]);

  /**
   * Everyone's work as one line each, sorted by what is late first.
   *
   * The per-member columns answer "what is on Bhavesh's plate"; they can't
   * answer "what is outstanding across the agency, and since when", because the
   * eye has to hop between columns of different heights. This reads top to
   * bottom in one pass — task, client, who has it, when it landed, when it is
   * due — and fills the empty space under the shorter columns.
   */
  const oneLine = (t: Task) => {
    const overdue = new Date(t.deadline).getTime() < now && t.status !== "done";
    const assignedOn = new Date(t.created_at);
    const ageDays = Math.floor((now - assignedOn.getTime()) / 86400000);
    const member = team.find((m) => m.name.toLowerCase() === (t.assignee_name || "").toLowerCase());
    return (
      <div key={t.id}
        className="grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg border border-slate-900 bg-slate-950/60 hover:border-slate-800 transition-colors">
        <div className="col-span-12 md:col-span-4 flex items-center gap-2 min-w-0">
          <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.medium}`} title={`Priority: ${t.priority}`} />
          <span className="text-xs font-semibold text-white truncate" title={t.title || ""}>{t.title || "Untitled task"}</span>
          {t.source === "whatsapp" && <MessageSquare className="w-3 h-3 shrink-0 text-emerald-500" aria-label="From WhatsApp" />}
          {t.source === "call" && <MessageSquare className="w-3 h-3 shrink-0 text-indigo-400" aria-label="From a call" />}
          {t.source === "excel_import" && <FileSpreadsheet className="w-3 h-3 shrink-0 text-slate-600" aria-label="Imported" />}
        </div>

        <div className="col-span-6 md:col-span-2 min-w-0">
          {t.clients?.name
            ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-950/40 border border-indigo-900 text-indigo-300 truncate inline-block max-w-full">{t.clients.name}</span>
            : <span className="text-[10px] text-slate-700">—</span>}
        </div>

        <div className="col-span-6 md:col-span-2 flex items-center gap-1.5 min-w-0">
          <Avatar name={t.assignee_name || "?"} url={member?.avatar_url} size={18} rounded="rounded-full" />
          <span className="text-[10px] text-slate-300 truncate">{t.assignee_name || "Unassigned"}</span>
        </div>

        <div className="col-span-6 md:col-span-2 text-[10px] font-mono text-slate-500" title={`Assigned ${assignedOn.toLocaleString("en-IN")}`}>
          {assignedOn.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          <span className="text-slate-700"> · {ageDays === 0 ? "today" : `${ageDays}d ago`}</span>
        </div>

        <div className="col-span-6 md:col-span-2 flex items-center justify-end gap-1.5">
          <span className={`flex items-center gap-1 text-[10px] font-mono font-bold ${overdue ? "text-red-400" : "text-slate-500"}`}>
            {overdue ? <AlertTriangle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {new Date(t.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
          {busy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (
            <>
              <select value={t.status} disabled={!!busy} onChange={(e) => patch(t.id, { status: e.target.value })}
                className={`text-[9px] font-bold rounded-md px-1.5 py-0.5 border cursor-pointer focus:outline-none ${STATUS_STYLE[t.status]}`}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
              <button onClick={() => remove(t.id)} disabled={!!busy} title="Delete task"
                className="p-1 rounded text-slate-700 hover:text-rose-400 cursor-pointer disabled:opacity-40">
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  /** Late first, then soonest due — the order you'd actually work through. */
  const byUrgency = useMemo(
    () => [...filtered].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()),
    [filtered]
  );

  return (
    <div className="space-y-5">
      {/* Board actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-slate-500">Everyone&apos;s work in one place — daily jobs, WhatsApp tasks and client grids.</p>
        <button onClick={() => setShowAdd((s) => !s)} className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white flex items-center space-x-2 cursor-pointer">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}<span>{showAdd ? "Close" : "Add Task"}</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Open Tasks", value: stats.open, cls: "text-white" },
          { label: "Due Today", value: stats.dueToday, cls: "text-amber-400" },
          { label: "Overdue", value: stats.overdue, cls: "text-red-400" },
          { label: "In Review", value: stats.review, cls: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
            <h3 className={`text-2xl font-extrabold ${s.cls}`}>{s.value}</h3>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Task — e.g. 'suvarna rakhi grid 3 posts'"
            className="md:col-span-2 text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-600"
          />
          <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            <option value="">Client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.assigneeName} onChange={(e) => setForm({ ...form, assigneeName: e.target.value })} className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            <option value="">Assign to…</option>
            {team.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 focus:outline-none" />
            <button onClick={addTask} disabled={saving || !form.title.trim()} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
          {(["open", "done"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${tab === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
              {t === "open" ? "Open" : "Done"}
            </button>
          ))}
        </div>
        <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1">
          <button onClick={() => setView("board")} title="Board by member" className={`p-2 rounded-lg cursor-pointer ${view === "board" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button onClick={() => setView("list")} title="List" className={`p-2 rounded-lg cursor-pointer ${view === "list" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}><Rows3 className="w-3.5 h-3.5" /></button>
        </div>
        <select value={filterMember} onChange={(e) => setFilterMember(e.target.value)} className="text-[10px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2.5 text-slate-300 cursor-pointer focus:outline-none">
          <option value="">All members</option>
          <option value="unassigned">Unassigned</option>
          {team.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="text-[10px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2.5 text-slate-300 cursor-pointer focus:outline-none">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-[10px] text-slate-600 font-mono ml-auto">{filtered.length} task(s)</span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-slate-600 py-16 text-center">No tasks here. Add one above, or create tasks from the WhatsApp Task Bar.</p>
      ) : null}

      {/* The whole picture and the team, side by side: every pending task on
          the left, every member and what's on their plate on the right. */}
      {!loading && filtered.length > 0 && (
        <div className={view === "board" ? "grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start" : ""}>
          <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Rows3 className="w-3.5 h-3.5 text-indigo-400" />
                <span>{tab === "done" ? "Completed" : "All pending tasks"}</span>
                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{byUrgency.length}</span>
              </h3>
              <span className="text-[10px] text-slate-600">Soonest due first</span>
            </div>
            <div className="hidden md:grid grid-cols-12 gap-2 px-3 text-[9px] font-bold uppercase tracking-wider text-slate-600">
              <span className="col-span-4">Task</span>
              <span className="col-span-2">Client</span>
              <span className="col-span-2">Assigned to</span>
              <span className="col-span-2">Assigned on</span>
              <span className="col-span-2 text-right">Due</span>
            </div>
            <div className="space-y-1.5">{byUrgency.map(oneLine)}</div>
          </div>

          {view === "board" && (
            <div className="space-y-2 xl:sticky xl:top-4">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-indigo-400" /><span>Team</span>
                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{team.length}</span>
              </h3>
              {/* Every member appears — an empty plate is information too. */}
              {[...team.map((m) => ({ name: m.name, member: m as Member | undefined, items: filtered.filter((t) => (t.assignee_name || "").toLowerCase() === m.name.toLowerCase()) })),
                ...columns.filter((c) => !c.member && c.name === "Unassigned")]
                .map((col) => {
                  const late = col.items.filter((t) => new Date(t.deadline).getTime() < now && t.status !== "done").length;
                  return (
                    <div key={col.name} className={`border rounded-xl bg-slate-950/50 ${late > 0 ? "border-rose-900/50" : "border-slate-900"}`}>
                      <button onClick={() => setFilterMember(filterMember === col.name ? "" : col.name === "Unassigned" ? "unassigned" : col.name)}
                        title="Click to filter the list to this person"
                        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-900/40 rounded-xl">
                        <div className="flex items-center gap-2 min-w-0">
                          {col.member ? (
                            <Avatar name={col.name} url={col.member.avatar_url} size={22} rounded="rounded-full" />
                          ) : (
                            <Users className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                          <div className="min-w-0 text-left">
                            <p className="text-xs font-bold text-white truncate">{col.name}</p>
                            {col.member?.role_title && <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">{col.member.role_title}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {late > 0 && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-950/60 border border-rose-900 text-rose-400">{late} late</span>}
                          <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{col.items.length}</span>
                        </div>
                      </button>
                      {col.items.length === 0 ? (
                        <p className="text-[10px] text-slate-600 px-3 pb-2">No open tasks.</p>
                      ) : (
                        <div className="px-2 pb-2 space-y-1">
                          {col.items.slice(0, 5).map((t) => {
                            const overdue = new Date(t.deadline).getTime() < now && t.status !== "done";
                            return (
                              <div key={t.id} className="flex items-center gap-2 text-[10px] bg-slate-950/60 border border-slate-900/70 rounded-lg px-2 py-1.5">
                                <span className="text-slate-300 truncate flex-1">{t.title || "Untitled"}</span>
                                {t.clients?.name && <span className="text-slate-600 truncate max-w-[70px]">{t.clients.name}</span>}
                                <span className={`font-mono shrink-0 ${overdue ? "text-rose-400 font-bold" : "text-slate-500"}`}>
                                  {new Date(t.deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                </span>
                              </div>
                            );
                          })}
                          {col.items.length > 5 && <p className="text-[9px] text-slate-600 px-1">+{col.items.length - 5} more — click the name to see all</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
