"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ListTodo, Loader2, Plus, X, Check, Users, LayoutGrid, Rows3,
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
interface Member { id: string; name: string; role_title: string | null; profile_id: string | null }
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

export default function TeamTasksPage() {
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

  const card = (t: Task, showAssignee: boolean) => {
    const overdue = new Date(t.deadline).getTime() < now && t.status !== "done";
    return (
      <div key={t.id} className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 space-y-2 hover:border-slate-800 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-white leading-snug whitespace-pre-wrap break-words">{t.title || "Untitled task"}</p>
          <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.medium}`} title={`Priority: ${t.priority}`} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-bold">
          {t.clients?.name && <span className="px-1.5 py-0.5 rounded bg-indigo-950/40 border border-indigo-900 text-indigo-300">{t.clients.name}</span>}
          <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">{TYPE_LABEL[t.type] || t.type}</span>
          {showAssignee && <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">{t.assignee_name || "Unassigned"}</span>}
          {t.source === "whatsapp" && <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-900 text-emerald-400 flex items-center gap-0.5"><MessageSquare className="w-2.5 h-2.5" />WA</span>}
          {t.source === "excel_import" && <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-500 flex items-center gap-0.5"><FileSpreadsheet className="w-2.5 h-2.5" />XLS</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 text-[9px] font-mono font-bold ${overdue ? "text-red-400" : "text-slate-500"}`}>
            {overdue ? <AlertTriangle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {new Date(t.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
          <div className="flex items-center gap-1">
            {busy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (
              <>
                <select
                  value={t.status}
                  disabled={!!busy}
                  onChange={(e) => patch(t.id, { status: e.target.value })}
                  className={`text-[9px] font-bold rounded-md px-1.5 py-0.5 border cursor-pointer focus:outline-none ${STATUS_STYLE[t.status]}`}
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
                {t.status !== "done" && (
                  <button disabled={!!busy} onClick={() => patch(t.id, { status: "done" })} title="Mark done"
                    className="p-1 rounded-md bg-emerald-950/40 border border-emerald-900 text-emerald-400 hover:bg-emerald-900/40 cursor-pointer">
                    <Check className="w-3 h-3" />
                  </button>
                )}
                <button disabled={!!busy} onClick={() => remove(t.id)} title="Delete (founder only)"
                  className="p-1 rounded-md bg-slate-900 border border-slate-800 text-slate-600 hover:text-red-400 cursor-pointer">
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>
        <select
          value={t.assignee_name || ""}
          disabled={!!busy}
          onChange={(e) => patch(t.id, { assigneeName: e.target.value })}
          className="w-full text-[9px] bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-slate-400 cursor-pointer focus:outline-none"
        >
          <option value="">Unassigned</option>
          {team.map((m) => <option key={m.id} value={m.name}>{m.name}{m.role_title ? ` · ${m.role_title}` : ""}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <ListTodo className="w-6 h-6 text-indigo-400" /><span>Team Tasks</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">One master board for the whole team — daily work, WhatsApp tasks and client grids in one place.</p>
        </div>
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
      ) : view === "board" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.name} className="w-72 shrink-0 space-y-2">
              <div className="flex items-center justify-between bg-slate-950/40 border border-slate-900 rounded-xl px-3 py-2">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs font-bold text-white">{col.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {col.member?.role_title && <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500">{col.member.role_title}</span>}
                  <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{col.items.length}</span>
                </div>
              </div>
              <div className="space-y-2">{col.items.map((t) => card(t, false))}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((t) => card(t, true))}
        </div>
      )}
    </div>
  );
}
