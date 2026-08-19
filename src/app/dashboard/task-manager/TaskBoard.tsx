"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Avatar from "../Avatar";
import {
  Loader2, Plus, X, Check, Users, Rows3,
  Calendar, AlertTriangle, MessageSquare, FileSpreadsheet, Trash2, Pencil,
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

/**
 * One data layer, two faces.
 *
 * "board" answers "what is outstanding across the agency, soonest first".
 * "team" answers "who is carrying what" — every member with their whole plate,
 * which a manager opens deliberately rather than reading it squeezed beside
 * the list.
 */
export default function TaskBoard({ mode = "board" }: { mode?: "board" | "team" }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filterMember, setFilterMember] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", clientId: "", assigneeName: "", type: "design", priority: "medium", deadline: "" });
  const [saving, setSaving] = useState(false);
  // The task being edited — one modal serves both the board and the team tab.
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ title: "", clientId: "", assigneeName: "", type: "other", priority: "medium", deadline: "" });

  const openEdit = (t: Task) => {
    setEditTask(t);
    setEditForm({
      title: t.title || "",
      clientId: t.client_id || "",
      assigneeName: t.assignee_name || "",
      type: t.type || "other",
      priority: t.priority || "medium",
      deadline: t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : "",
    });
  };

  const saveEdit = async () => {
    if (!editTask || !editForm.title.trim()) return;
    await patch(editTask.id, {
      title: editForm.title,
      clientId: editForm.clientId || null,
      assigneeName: editForm.assigneeName,
      type: editForm.type,
      priority: editForm.priority,
      deadline: editForm.deadline || undefined,
    });
    setEditTask(null);
  };

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

  /**
   * Who earns a card on the team page: everyone with a portal account (an
   * empty plate on a real teammate is information), plus anyone else only
   * while tasks are allotted to them. Names that never signed up and hold
   * nothing — old imports, people who left — don't clutter the view, but
   * they stay in the assign dropdowns and reappear the moment work lands
   * on them. The board only ever lists people actually holding work.
   */
  const columns = useMemo(() => {
    const names = team.map((m) => m.name);
    // Names that appear on tasks but not in the team table (imported rows).
    const extra = [...new Set(filtered.map((t) => t.assignee_name).filter((n): n is string => !!n && !names.some((x) => x.toLowerCase() === n.toLowerCase())))];
    const cols = [...names, ...extra]
      .map((name) => ({
        name,
        member: team.find((m) => m.name === name),
        items: filtered.filter((t) => (t.assignee_name || "").toLowerCase() === name.toLowerCase()),
      }))
      .filter((c) => c.items.length > 0 || (mode === "team" && !!c.member?.profile_id))
      // Busiest first, and anyone carrying late work above the rest.
      .sort((a, b) => b.items.length - a.items.length);
    const unassigned = filtered.filter((t) => !t.assignee_name);
    if (unassigned.length > 0) cols.push({ name: "Unassigned", member: undefined, items: unassigned });
    return cols;
  }, [filtered, team, mode]);

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
              <button onClick={() => openEdit(t)} disabled={!!busy} title="Edit task"
                className="p-1 rounded text-slate-700 hover:text-indigo-400 cursor-pointer disabled:opacity-40">
                <Pencil className="w-3 h-3" />
              </button>
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
      ) : mode === "board" && filtered.length === 0 ? (
        <p className="text-xs text-slate-600 py-16 text-center">No tasks here. Add one above, or create tasks from the WhatsApp Task Bar.</p>
      ) : null}

      {/* Board tab: the whole picture — every pending task, soonest due first. */}
      {!loading && mode === "board" && filtered.length > 0 && (
        <div className="space-y-2">
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
      )}

      {/* Team tab: who is carrying what — every member's whole plate, full width. */}
      {!loading && mode === "team" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {columns.map((col) => {
            const late = col.items.filter((t) => new Date(t.deadline).getTime() < now && t.status !== "done").length;
            const isCollapsed = !!collapsed[col.name];
            return (
              <div key={col.name} className={`border rounded-2xl bg-slate-950/50 ${late > 0 ? "border-rose-900/50" : "border-slate-900"}`}>
                <button onClick={() => setCollapsed((p) => ({ ...p, [col.name]: !p[col.name] }))}
                  title={isCollapsed ? "Show tasks" : "Hide tasks"}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-slate-900/40 rounded-2xl">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {col.member ? (
                      <Avatar name={col.name} url={col.member.avatar_url} size={26} rounded="rounded-full" />
                    ) : (
                      <Users className="w-4 h-4 text-indigo-400" />
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
                {!isCollapsed && (col.items.length === 0 ? (
                  <p className="text-[10px] text-slate-600 px-3.5 pb-2.5">No open tasks.</p>
                ) : (
                  <div className="px-2.5 pb-2.5 space-y-1">
                    {col.items.map((t) => {
                      const overdue = new Date(t.deadline).getTime() < now && t.status !== "done";
                      return (
                        <div key={t.id} className="flex items-center gap-2 text-[10px] bg-slate-950/60 border border-slate-900/70 rounded-lg px-2 py-1.5">
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.medium}`} />
                          <span className="text-slate-300 truncate flex-1" title={t.title || ""}>{t.title || "Untitled"}</span>
                          {t.clients?.name && <span className="text-slate-600 truncate max-w-[80px]">{t.clients.name}</span>}
                          <span className={`font-mono shrink-0 ${overdue ? "text-rose-400 font-bold" : "text-slate-500"}`}>
                            {new Date(t.deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                          <select value={t.status} disabled={!!busy} onChange={(e) => patch(t.id, { status: e.target.value })}
                            className={`text-[8px] font-bold rounded px-1 py-0.5 border cursor-pointer focus:outline-none shrink-0 ${STATUS_STYLE[t.status]}`}>
                            <option value="todo">To Do</option>
                            <option value="in_progress">Doing</option>
                            <option value="review">Review</option>
                            <option value="done">Done</option>
                          </select>
                          <button onClick={() => openEdit(t)} disabled={!!busy} title="Edit task"
                            className="p-0.5 rounded text-slate-700 hover:text-indigo-400 cursor-pointer disabled:opacity-40 shrink-0">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => remove(t.id)} disabled={!!busy} title="Delete task"
                            className="p-0.5 rounded text-slate-700 hover:text-rose-400 cursor-pointer disabled:opacity-40 shrink-0">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal — one for both tabs. */}
      {editTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditTask(null)}>
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-indigo-400" /><span>Edit task</span></h3>
              <button onClick={() => setEditTask(null)} className="text-slate-600 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Task</span>
              <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-600" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Client</span>
                <select value={editForm.clientId} onChange={(e) => setEditForm({ ...editForm, clientId: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                  <option value="">No client</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Assigned to</span>
                <select value={editForm.assigneeName} onChange={(e) => setEditForm({ ...editForm, assigneeName: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                  <option value="">Unassigned</option>
                  {team.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Type</span>
                <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Priority</span>
                <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="col-span-2">
                <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Deadline</span>
                <input type="date" value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button onClick={() => { const id = editTask.id; setEditTask(null); remove(id); }} disabled={!!busy}
                className="px-3 py-2 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-400 text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                <Trash2 className="w-3 h-3" /><span>Delete</span>
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditTask(null)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-bold cursor-pointer hover:text-white">Cancel</button>
                <button onClick={saveEdit} disabled={!!busy || !editForm.title.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}<span>Save</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
