"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Avatar from "../Avatar";
import { fmtIST, istToday } from "@/lib/time";
import { fetchSuggestion, suggestionKey, type RouteSuggestion } from "@/lib/task-suggestion";
import { uploadTaskFile, humanSize } from "@/lib/drive-upload-client";
import {
  Loader2, Plus, X, Check, Users, Rows3,
  Calendar, AlertTriangle, MessageSquare, FileSpreadsheet, Trash2, Pencil, ScanLine, ChevronDown, ChevronLeft, ChevronRight, Paperclip,
} from "lucide-react";

interface Task {
  id: string;
  title: string | null;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  deadline: string | null;
  source: string;
  assignee_name: string | null;
  assignee_id: string | null;
  client_id: string | null;
  created_at: string;
  completed_at: string | null;
  /** How many times the deadline has been pushed to a later day. Server-kept. */
  reschedule_count?: number | null;
  clients?: { name: string } | null;
  attachments?: Attachment[];
}

/** A file living in Drive, pointed at from a task. */
interface Attachment { id: string; task_id: string; file_name: string; mime: string | null; size_bytes: number | null; url: string; created_at: string }
interface Member { id: string; name: string; role_title: string | null; profile_id: string | null; avatar_url: string | null; away_until: string | null }
interface ClientRow { id: string; name: string }
/** A member's last 60 days, as /api/team-profile computes them. */
interface MemberProfile {
  id: string; name: string; openLoad: number; doneCount: number;
  onTimePct: number | null;
  speed: { type: string; medianDays: number; count: number }[];
  qcPassPct: number | null;
  topClients: { name: string; count: number }[];
}

const TYPE_LABEL: Record<string, string> = {
  design: "Design", video_edit: "Video Edit", ai_video: "AI Video", script: "Script",
  planning: "Planning", packaging: "Packaging", print: "Print", copy: "Copy",
  image: "Image", video: "Video", ads: "Ads", other: "Task",
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-rose-500", high: "bg-rose-400", medium: "bg-amber-400", low: "bg-slate-600",
};

/**
 * Two answers, not four.
 *
 * The board writes `medium` or `urgent` now, but years of rows carry `low` and
 * `high` and nobody is rewriting them: anything that isn't `urgent` reads as
 * Normal, which is what those rows always meant in practice.
 */
const isUrgent = (t: { priority: string }) => t.priority === "urgent";
/**
 * The Indian calendar day an instant falls on, "YYYY-MM-DD" — what a date input
 * wants and what the completed strip groups by. The browser's own day is the
 * wrong answer for anyone reading the board from outside India.
 */
const istDayOf = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
/** The clock time of a finish, in IST — "17:40". */
const istTimeOf = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
/** Today-in-India plus n days, "YYYY-MM-DD" — what "Tomorrow" means here. */
const istDayPlus = (n: number) => {
  const [y, m, d] = istToday().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Rose, wherever the task is drawn. Colour is the whole feature. */
function UrgentChip() {
  return (
    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-900 text-rose-400">
      Urgent
    </span>
  );
}

/**
 * How often this one has been pushed. Ten pushes is a signal, not a number.
 *
 * On an open row a zero is noise — nothing has happened to that task yet, and a
 * badge on every card buys nothing. On finished work it is the answer: asked
 * "how many times was this pushed", "none" is a reply, and a missing badge is
 * not. So `showZero` on the completed calendar, nowhere else.
 */
function RescheduleBadge({ n, showZero = false }: { n: number | null | undefined; showZero?: boolean }) {
  const count = Number(n) || 0;
  if (count < 1 && !showZero) return null;
  return (
    <span title={`Rescheduled ${count} time(s)`}
      className={`shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
        count >= 10 ? "bg-amber-950/40 border-amber-900 text-amber-400"
          : count < 1 ? "bg-slate-900/60 border-slate-900 text-slate-600"
          : "bg-slate-900 border-slate-800 text-slate-400"
      }`}>
      ↻ {count}
    </span>
  );
}
/** Away today, or away until a day still ahead. */
export function awayLabel(awayUntil: string | null | undefined): string | null {
  if (!awayUntil) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (awayUntil < today) return null;
  const when = new Date(`${awayUntil}T12:00:00Z`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  return `away till ${when}`;
}

/** Where a task came from, in the words a manager uses for it. */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Manager", whatsapp: "WhatsApp", call: "Call",
  excel_import: "Excel import", sheet_scan: "Job sheet", plan: "Plan",
  festival: "Festival",
};
/** One key, one question: was the completed strip left open? */
const COMPLETED_STRIP_KEY = "tbw.taskboard.completedStrip";
const STATUS_STYLE: Record<string, string> = {
  todo: "bg-slate-900 border-slate-800 text-slate-400",
  in_progress: "bg-blue-950/40 border-blue-900 text-blue-400",
  review: "bg-amber-950/40 border-amber-900 text-amber-400",
  done: "bg-emerald-950/40 border-emerald-900 text-emerald-400",
};

/** Monday first — the studio's week, not the spreadsheet's. */
const WEEK_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Finished work, as a calendar rather than a queue.
 *
 * Pouring every finished task into one per-designer list answers nothing: at
 * twenty-four rows a person, "what went out on the 16th" is a scroll, and the
 * founder asks it by date. So: a month with a count on every day, and under it
 * the day you picked, read down a person the way the rest of the board reads.
 *
 * Whatever is passed in is the whole universe — there is no fetch here, and no
 * API knows about this view. Bucketing is Indian-calendar throughout; the
 * browser's own day is the wrong answer for anyone reading from outside India.
 */
function CompletedCalendar({ tasks, team }: { tasks: Task[]; team: Member[] }) {
  const today = istToday();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  // Today when we open on this month; nothing when the arrows have carried us
  // somewhere else, because picking a day for the founder there would only be
  // picking the wrong one.
  const [selected, setSelected] = useState(() => today);

  /** Every finish filed under the Indian day it happened on. One pass serves both halves. */
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status !== "done") continue;
      const day = istDayOf(t.completed_at);
      if (!day) continue;
      map.set(day, [...(map.get(day) || []), t]);
    }
    return map;
  }, [tasks]);

  /**
   * The month as 7-column rows: leading blanks to reach Monday, then the days,
   * then blanks to close the last week. Plain calendar arithmetic on the key
   * string — no instant is converted, so no zone can shift it.
   */
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= length; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const monthLabel = new Date(`${month}-01T12:00:00Z`)
    .toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
  const monthTotal = cells.reduce((n, key) => n + (key ? (byDay.get(key)?.length || 0) : 0), 0);

  const goMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const moved = new Date(Date.UTC(y, m - 1 + delta, 1));
    const key = `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
    setMonth(key);
    setSelected(key === today.slice(0, 7) ? today : "");
  };

  /**
   * The chosen day, designer by designer.
   *
   * Grouped by the name on the task because that is how the founder reads it —
   * down a person, not down a clock. Whoever finished nothing simply isn't
   * here; unassigned work sits last.
   */
  const groups = useMemo(() => {
    const onDay = selected ? (byDay.get(selected) || []) : [];
    const buckets = new Map<string, Task[]>();
    for (const t of onDay) {
      const name = (t.assignee_name || "").trim() || "Unassigned";
      buckets.set(name, [...(buckets.get(name) || []), t]);
    }
    return [...buckets.entries()]
      .map(([name, items]) => ({
        name,
        member: team.find((m) => m.name.toLowerCase() === name.toLowerCase()),
        items: items.sort((a, b) => (a.completed_at || "").localeCompare(b.completed_at || "")),
      }))
      .sort((a, b) => (a.name === "Unassigned" ? 1 : b.name === "Unassigned" ? -1 : a.name.localeCompare(b.name)));
  }, [byDay, selected, team]);

  const dayLabel = selected
    ? new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })
    : "";

  return (
    <div className="space-y-3">
      {/* The month, and the two arrows that reach the ones before it. */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => goMonth(-1)} title="Previous month"
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-900 bg-slate-950/60 text-slate-400 hover:text-indigo-300 hover:border-indigo-700 cursor-pointer">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-xs font-bold text-white truncate">{monthLabel}</p>
          <p className="text-[10px] font-mono text-slate-600">{monthTotal} done this month</p>
        </div>
        <button onClick={() => goMonth(1)} title="Next month"
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-900 bg-slate-950/60 text-slate-400 hover:text-indigo-300 hover:border-indigo-700 cursor-pointer">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Seven equal columns, so the grid fits a phone without the page sliding
          sideways. The count is the whole point of a cell: a bare number means
          nothing went out that day. */}
      <div className="grid grid-cols-7 gap-1">
        {WEEK_HEAD.map((d, i) => (
          <span key={i} className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-600 text-center pb-0.5">
            <span className="hidden sm:inline">{d}</span><span className="sm:hidden">{d[0]}</span>
          </span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`blank-${i}`} />;
          const n = byDay.get(key)?.length || 0;
          const isToday = key === today;
          const isPicked = key === selected;
          return (
            <button key={key} onClick={() => setSelected(key)}
              title={`${key} — ${n} finished`}
              className={`min-h-[40px] rounded-lg border px-0.5 py-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                isPicked ? "bg-indigo-600 border-indigo-500 text-white"
                  : n > 0 ? "bg-slate-950/60 border-slate-800 text-slate-200 hover:border-indigo-700"
                  : "bg-transparent border-slate-900 text-slate-600 hover:border-slate-800"
              } ${isToday && !isPicked ? "ring-1 ring-indigo-500" : ""}`}>
              <span className="text-[11px] font-bold leading-none">{Number(key.slice(8))}</span>
              {n > 0 && (
                <span className={`text-[8px] font-mono font-bold leading-none px-1 py-0.5 rounded-full ${
                  isPicked ? "bg-white/20 text-white" : "bg-emerald-950/60 border border-emerald-900 text-emerald-400"
                }`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* The day itself. Same row as the board has always drawn — title, client,
          urgency, how often it was pushed, and the IST clock time it landed. */}
      {!selected ? (
        <p className="text-[11px] text-slate-600">Pick a day.</p>
      ) : groups.length === 0 ? (
        <p className="text-[11px] text-slate-600">Nothing completed on this day.</p>
      ) : (
        <div className="space-y-3 pt-1 border-t border-slate-900">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-2">{dayLabel}</p>
          {groups.map((g) => (
            <div key={g.name} className="space-y-1">
              <div className="flex items-center gap-2">
                <Avatar name={g.name} url={g.member?.avatar_url} size={20} rounded="rounded-full" />
                <span className="text-[11px] font-bold text-white truncate">{g.name}</span>
                <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{g.items.length}</span>
              </div>
              <div className="space-y-1 pl-1">
                {g.items.map((t) => (
                  <div key={t.id}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${isUrgent(t)
                      ? "border-rose-900/60 border-l-2 border-l-rose-500 bg-rose-950/10"
                      : "border-slate-900 bg-slate-950/60"}`}>
                    <Check className="w-3 h-3 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1 text-[11px] text-slate-300 truncate" title={t.title || ""}>{t.title || "Untitled"}</span>
                    {t.clients?.name && (
                      <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-950/40 border border-indigo-900 text-indigo-300 truncate max-w-[120px]">{t.clients.name}</span>
                    )}
                    {isUrgent(t) && <UrgentChip />}
                    <RescheduleBadge n={t.reschedule_count} showZero />
                    <span className="shrink-0 text-[10px] font-mono text-slate-500">{istTimeOf(t.completed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filterMember, setFilterMember] = useState("");
  const [filterClient, setFilterClient] = useState("");
  // How the list is ordered. Due-soonest stays the default — it is the order
  // you would actually work through — but a manager reviewing what landed
  // this week wants newest-assigned first, so the choice is theirs.
  const [sortBy, setSortBy] = useState<"due_asc" | "due_desc" | "assigned_desc" | "assigned_asc" | "priority">("due_asc");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", clientId: "", assigneeName: "", type: "design", priority: "medium", deadline: "" });
  const [saving, setSaving] = useState(false);
  // The router's read on the task being typed. Only ever offered into an empty
  // assignee field — a name already chosen is a decision, not a placeholder.
  const [addSuggestion, setAddSuggestion] = useState<RouteSuggestion | null>(null);
  // Files chosen in the modal, and how far each has got. The task is saved
  // first and the files follow, so a refused upload never costs the task.
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [uploadPct, setUploadPct] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  /** One at a time: two half-gigabyte uploads at once is how both fail. */
  const sendFiles = async (taskId: string, files: File[]): Promise<string[]> => {
    const failures: string[] = [];
    for (const file of files) {
      try {
        await uploadTaskFile(taskId, file, (f) => setUploadPct((p) => ({ ...p, [file.name]: Math.round(f * 100) })));
      } catch (err: unknown) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
    }
    return failures;
  };

  const removeAttachment = async (id: string) => {
    if (!confirm("Remove this file? It is deleted from Drive too.")) return;
    await fetch("/api/task-files", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await fetchAll(tab);
  };
  // Two months of each member's actual work, and whether the PM is assigning
  // by itself. Both only matter on the Team tab.
  const [profiles, setProfiles] = useState<Record<string, MemberProfile>>({});
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  const [pmOn, setPmOn] = useState(false);
  const [pmCanToggle, setPmCanToggle] = useState(false);
  const [pmBusy, setPmBusy] = useState(false);
  // Whether THIS viewer may delete — decided by the API (founder, or an
  // employee the founder granted it to) and echoed on every load, so the button
  // never appears where pressing it could only return a 403.
  const [canDelete, setCanDelete] = useState(false);
  // And whether they may hand work to someone else — the same named grant,
  // decided by the API. Without it nothing is draggable and the edit modal
  // shows the name rather than a dropdown.
  const [canMove, setCanMove] = useState(false);
  // The card in the air, and the column it is hovering over.
  const [dragTask, setDragTask] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // Which task's Reschedule options are open — one at a time, like a menu.
  const [reschedFor, setReschedFor] = useState<string | null>(null);
  // What the server refused, in its own words — a forged reassignment, or the
  // 50th push of a task nobody is ever going to do.
  const [actionError, setActionError] = useState<string | null>(null);
  // Board mode only: the day's finishes, fetched separately because the board
  // itself is showing open work.
  const [doneTasks, setDoneTasks] = useState<Task[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  // A job sheet read from an image, waiting for a human to check and assign.
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<null | {
    sheetUrl: string | null; sheetWarning: string | null; clientId: string;
    clientHint: string; summary: string; flagged: number;
    rows: { title: string; size: string; qty: string; remark: string; type: string; issues: string[]; include: boolean; assigneeName: string }[];
  }>(null);
  const [scanClient, setScanClient] = useState("");
  const [scanDeadline, setScanDeadline] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement>(null);

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
      deadline: istDayOf(t.deadline),
    });
  };

  const saveEdit = async () => {
    if (!editTask || !editForm.title.trim()) return;
    await patch(editTask.id, {
      title: editForm.title,
      clientId: editForm.clientId || null,
      // Only send the name when this account may change it — the server refuses
      // the field outright, and an editor without the grant is still allowed to
      // fix a title.
      ...(canMove ? { assigneeName: editForm.assigneeName } : {}),
      type: editForm.type,
      priority: editForm.priority,
      // null, not undefined: clearing the field has to actually clear it.
      deadline: editForm.deadline || null,
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
        setCanDelete(!!d.canDelete);
        setCanMove(!!d.canMove);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(tab); }, [tab, fetchAll]);

  // The completed strip remembers whether it was left open — a founder who
  // reads it every morning shouldn't have to unfold it every morning.
  useEffect(() => {
    if (mode !== "board") return;
    try { setCompletedOpen(localStorage.getItem(COMPLETED_STRIP_KEY) === "1"); } catch { /* private mode */ }
  }, [mode]);

  const toggleCompleted = () => {
    setCompletedOpen((open) => {
      const next = !open;
      try { localStorage.setItem(COMPLETED_STRIP_KEY, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  };

  // Finished work is its own question — asked only when the strip is open, and
  // not at all on the Completed tab, where `tasks` already IS the finished set.
  // One view, one fetch.
  useEffect(() => {
    if (mode !== "board" || !completedOpen || tab === "done") return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/team-tasks?status=done", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const d = await res.json();
        setDoneTasks(d.tasks || []);
      } catch { /* the strip simply stays empty */ }
    })();
    return () => { alive = false; };
  }, [mode, completedOpen, tab]);

  useEffect(() => {
    if (mode !== "team") return;
    (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          fetch("/api/team-profile", { cache: "no-store" }),
          fetch("/api/pm-auto-assign", { cache: "no-store" }),
        ]);
        if (pRes.ok) {
          const d = await pRes.json();
          setProfiles(Object.fromEntries(((d.profiles || []) as MemberProfile[]).map((p) => [p.name.toLowerCase().trim(), p])));
        }
        if (sRes.ok) { const d = await sRes.json(); setPmOn(!!d.on); setPmCanToggle(!!d.canToggle); }
      } catch { /* the board works without either */ }
    })();
  }, [mode]);

  const togglePm = async () => {
    setPmBusy(true);
    try {
      const res = await fetch("/api/pm-auto-assign", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !pmOn }),
      });
      if (res.ok) setPmOn((await res.json()).on);
    } finally { setPmBusy(false); }
  };

  // A refusal now has something to say — a task pushed fifty times, or a move
  // this account was never granted — so the answer is read, not thrown away.
  const patch = async (id: string, fields: Record<string, unknown>) => {
    setBusy(id);
    setActionError(null);
    try {
      const res = await fetch("/api/team-tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || "That change didn't go through.");
      }
      await fetchAll(tab);
    } finally { setBusy(null); }
  };

  /**
   * A card let go over someone else's column.
   *
   * Only the name moves — not the status, not the deadline, not the priority —
   * because dragging is how a manager says "you take this", and nothing else.
   * The column redraws immediately and the reload puts the server's answer
   * (including a refusal) back on screen a moment later.
   */
  const dropOnColumn = async (colName: string, droppedId?: string) => {
    // The payload travels in the event itself as well as in state: state is
    // what draws the highlight, but the drop must work even if a re-render
    // raced the drag and state never caught up.
    const id = dragTask || droppedId || null;
    setDragTask(null);
    setDragOverCol(null);
    if (!id || !canMove) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const target = colName === "Unassigned" ? "" : colName;
    // Dropped back where it started: nothing happened.
    if ((task.assignee_name || "").toLowerCase() === target.toLowerCase()) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, assignee_name: target || null } : t)));
    await patch(id, { assigneeName: target });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    setBusy(id);
    try {
      await fetch("/api/team-tasks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      await fetchAll(tab);
    } finally { setBusy(null); }
  };

  const readSheet = async (file: File) => {
    setScanning(true);
    setScanError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/team-tasks/scan", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not read the sheet");
      setScan({
        sheetUrl: d.sheetUrl || null,
        sheetWarning: d.sheetWarning || null,
        clientId: d.clientId || "",
        clientHint: d.clientHint || "",
        summary: d.summary || "",
        flagged: d.flagged || 0,
        rows: (d.tasks || []).map((t: Record<string, unknown>) => ({
          title: String(t.title || ""), size: String(t.size || ""), qty: String(t.qty || ""),
          remark: String(t.remark || ""), type: String(t.type || "print"),
          issues: (t.issues as string[]) || [], include: true, assigneeName: "",
        })),
      });
      setScanClient(d.clientId || "");
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Could not read the sheet");
    } finally {
      setScanning(false);
      if (sheetInputRef.current) sheetInputRef.current.value = "";
    }
  };

  const createFromSheet = async () => {
    if (!scan) return;
    setCreating(true);
    setScanError(null);
    try {
      const res = await fetch("/api/team-tasks/scan", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: scanClient || null,
          sheetUrl: scan.sheetUrl,
          tasks: scan.rows.filter((r) => r.include).map((r) => ({ ...r, deadline: scanDeadline || undefined })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create the tasks");
      setScan(null);
      setScanDeadline("");
      await fetchAll(tab);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Could not create the tasks");
    } finally { setCreating(false); }
  };

  /** Mark a member away (or back). The boards read this everywhere a name is offered. */
  const setAway = async (memberId: string, awayUntil: string | null) => {
    setTeam((prev) => prev.map((m) => (m.id === memberId ? { ...m, away_until: awayUntil } : m)));
    await fetch("/api/team-members", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: memberId, awayUntil }),
    });
    await fetchAll(tab);
  };

  // Flicking through the type dropdown should not become twelve requests.
  useEffect(() => {
    if (!showAdd) { setAddSuggestion(null); return; }
    if (form.assigneeName) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const s = await fetchSuggestion(form.clientId, form.type);
      if (!alive) return;
      setAddSuggestion(s);
      // Pre-select only if the field is STILL empty when the answer lands.
      setForm((f) => (f.assigneeName || !s ? f : { ...f, assigneeName: s.name }));
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // suggestionKey() is what actually changes the question being asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, suggestionKey(form.clientId, form.type), form.assigneeName]);

  const addTask = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setUploadErrors([]);
    try {
      // The task row first, then its files. A 500MB upload that fails halfway
      // must not take the typed-out task with it.
      const res = await fetch("/api/team-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error || "Could not create the task");

      const failures = created.id && pickedFiles.length > 0 ? await sendFiles(created.id, pickedFiles) : [];
      setUploadErrors(failures);
      setForm({ title: "", clientId: "", assigneeName: "", type: "design", priority: "medium", deadline: "" });
      setPickedFiles([]);
      setUploadPct({});
      if (fileRef.current) fileRef.current.value = "";
      // A failure list is only useful while the form is still on screen.
      if (failures.length === 0) setShowAdd(false);
      await fetchAll(tab);
    } catch (err: unknown) {
      setUploadErrors([err instanceof Error ? err.message : "Could not create the task"]);
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
      overdue: open.filter((t) => t.deadline && new Date(t.deadline).getTime() < startToday.getTime()).length,
      dueToday: open.filter((t) => { if (!t.deadline) return false; const d = new Date(t.deadline).getTime(); return d >= startToday.getTime() && d <= today.getTime(); }).length,
      review: open.filter((t) => t.status === "review").length,
    };
  }, [tasks]);

  /**
   * What the strip and the Completed tab are looking at.
   *
   * "What went out" is a different question from "what is left", and the board
   * could only ever answer the second — hence the separate fetch. On the
   * Completed tab there is nothing to fetch: the board is already holding the
   * finished rows, so the strip reads those instead of asking twice.
   */
  const completedSource = tab === "done" ? tasks : doneTasks;

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
  const toggleExpanded = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  /**
   * Normal or Urgent, and nothing in between.
   *
   * The four-level select asked a question nobody in the studio answers the
   * same way twice. This one asks the only question that changes what anyone
   * does today, and the answer is a colour.
   */
  const priorityToggle = (value: string, onPick: (p: string) => void) => (
    <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 min-h-[40px] lg:min-h-0">
      {([["medium", "Normal"], ["urgent", "Urgent"]] as const).map(([p, label]) => {
        const on = p === "urgent" ? value === "urgent" : value !== "urgent";
        return (
          <button key={p} type="button" onClick={() => onPick(p)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
              on ? (p === "urgent" ? "bg-rose-600 text-white" : "bg-indigo-600 text-white") : "text-slate-500 hover:text-white"
            }`}>
            {label}
          </button>
        );
      })}
    </div>
  );

  const metaChip = (label: string, value: string) => (
    <span key={label} className="text-[9px] bg-slate-900/60 border border-slate-800 rounded px-1.5 py-0.5 whitespace-nowrap">
      <span className="font-bold uppercase tracking-wider text-slate-600">{label}</span>
      <span className="ml-1 font-semibold text-slate-300 capitalize">{value}</span>
    </span>
  );

  /**
   * The whole task, opened in place.
   *
   * A row can only ever carry a truncated title, and at review time the
   * description is the part that decides anything — it was written, stored and
   * never shown. Read-only on purpose: changing a task still goes through the
   * pencil, so nothing is edited by accident while reading.
   */
  const taskDetail = (t: Task) => (
    <div className="px-3 pb-3 pt-2 space-y-2 border-t border-slate-900/70">
      <p className="text-xs font-semibold text-white break-words">{t.title || "Untitled task"}</p>
      {t.description?.trim()
        ? <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words">{t.description}</p>
        : <p className="text-[11px] text-slate-600 italic">No description was written.</p>}
      <div className="flex flex-wrap gap-1">
        {metaChip("Type", TYPE_LABEL[t.type] || t.type || "Task")}
        {metaChip("Priority", isUrgent(t) ? "Urgent" : "Normal")}
        {metaChip("Client", t.clients?.name || "—")}
        {metaChip("Assigned", fmtIST(t.created_at))}
        {metaChip("From", SOURCE_LABEL[t.source] || t.source || "Manager")}
      </div>
      {/* Pushing a job to tomorrow is the commonest edit on the board, and it
          used to mean opening the modal. The Reschedule button makes the push a
          named act: every use of it is counted — even a task born with no
          deadline being told "tomorrow" — which is what makes the ↻ number
          honest. The bare date input stays for corrections; it only counts
          when it moves an existing deadline later. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Due</span>
        <input type="date" value={istDayOf(t.deadline)} disabled={busy === t.id}
          onChange={(e) => patch(t.id, { deadline: e.target.value || null })}
          title="Correct this task's deadline — moving an existing one later is counted"
          className="min-h-[40px] lg:min-h-0 text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-600 disabled:opacity-50" />
        {!t.deadline && <span className="text-[10px] text-slate-600">no deadline yet</span>}
        <button onClick={() => setReschedFor((v) => (v === t.id ? null : t.id))} disabled={busy === t.id}
          title="Push this task — every reschedule is counted on the task"
          className={`min-h-[40px] lg:min-h-0 inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer disabled:opacity-50 ${
            reschedFor === t.id
              ? "bg-indigo-600 border-indigo-500 text-white"
              : "bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-indigo-600"
          }`}>
          ↻ Reschedule
        </button>
        <RescheduleBadge n={t.reschedule_count} />
        {reschedFor === t.id && (
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            {([["Tomorrow", 1], ["+2 days", 2]] as const).map(([label, days]) => (
              <button key={label} disabled={busy === t.id}
                onClick={() => { setReschedFor(null); patch(t.id, { deadline: istDayPlus(days), reschedule: true }); }}
                className="min-h-[40px] lg:min-h-0 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-amber-900 bg-amber-950/30 text-amber-300 hover:bg-amber-950/60 cursor-pointer disabled:opacity-50">
                {label}
              </button>
            ))}
            <input type="date" min={istToday()} disabled={busy === t.id}
              onChange={(e) => { if (!e.target.value) return; setReschedFor(null); patch(t.id, { deadline: e.target.value, reschedule: true }); }}
              title="Reschedule to a specific date"
              className="min-h-[40px] lg:min-h-0 text-[10px] bg-slate-950 border border-amber-900 rounded-lg px-2 py-1 text-amber-300 cursor-pointer [color-scheme:dark] focus:outline-none focus:border-amber-600 disabled:opacity-50" />
          </span>
        )}
      </div>
      {(t.attachments || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(t.attachments || []).map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 text-[10px] bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1">
              <Paperclip className="w-3 h-3 text-slate-500 shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-indigo-400 truncate max-w-[220px]">{f.file_name}</a>
              <span className="text-slate-600 font-mono shrink-0">{humanSize(f.size_bytes)}</span>
              <button onClick={() => removeAttachment(f.id)} title="Remove this file"
                className="text-slate-700 hover:text-rose-400 cursor-pointer shrink-0">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  /**
   * One row, two shapes. From md: up it is the 12-column grid, unchanged. Below
   * that the same cells restack into three lines the eye can actually follow —
   * the task, then who has it and when it landed, then when it is due and what
   * can be done about it — because on a phone the wide grid falls apart into
   * scraps of 10px text nobody can read.
   */
  const oneLine = (t: Task) => {
    const isOpen = !!expanded[t.id];
    const overdue = !!t.deadline && new Date(t.deadline).getTime() < now && t.status !== "done";
    const assignedOn = new Date(t.created_at);
    const ageDays = Math.floor((now - assignedOn.getTime()) / 86400000);
    const member = team.find((m) => m.name.toLowerCase() === (t.assignee_name || "").toLowerCase());
    return (
      <div key={t.id}
        className={`rounded-lg border transition-colors ${isUrgent(t)
          ? "border-rose-900/60 border-l-2 border-l-rose-500 bg-rose-950/10 hover:border-rose-800"
          : "border-slate-900 bg-slate-950/60 hover:border-slate-800"}`}>
      <div className="grid grid-cols-12 gap-x-2 gap-y-1.5 md:gap-2 items-center px-3 py-2.5 md:py-2">
        <div className="col-span-12 md:col-span-4 flex items-center gap-2 min-w-0">
          <button onClick={() => toggleExpanded(t.id)} title={isOpen ? "Hide the full task" : "Show the full task"}
            className="shrink-0 -ml-1 p-2 lg:p-1 min-h-[40px] min-w-[40px] lg:min-h-0 lg:min-w-0 rounded text-slate-400 md:text-slate-600 hover:text-indigo-400 cursor-pointer">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
          <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.medium}`} title={`Priority: ${t.priority}`} />
          <button onClick={() => toggleExpanded(t.id)} title={t.title || ""}
            className="min-w-0 text-left text-[13px] md:text-xs font-semibold text-white truncate py-1.5 -my-1.5 hover:text-indigo-300 cursor-pointer">
            {t.title || "Untitled task"}
          </button>
          {t.source === "whatsapp" && <MessageSquare className="w-3 h-3 shrink-0 text-emerald-500" aria-label="From WhatsApp" />}
          {t.source === "call" && <MessageSquare className="w-3 h-3 shrink-0 text-indigo-400" aria-label="From a call" />}
          {t.source === "excel_import" && <FileSpreadsheet className="w-3 h-3 shrink-0 text-slate-600" aria-label="Imported" />}
          {isUrgent(t) && <UrgentChip />}
          <RescheduleBadge n={t.reschedule_count} />
        </div>

        <div className="col-span-4 md:col-span-2 min-w-0">
          {t.clients?.name
            ? <span className="text-[11px] md:text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-950/40 border border-indigo-900 text-indigo-300 truncate inline-block max-w-full">{t.clients.name}</span>
            : <span className="text-[11px] md:text-[10px] text-slate-400 md:text-slate-700">—</span>}
        </div>

        <div className="col-span-4 md:col-span-2 flex items-center gap-1.5 min-w-0">
          <Avatar name={t.assignee_name || "?"} url={member?.avatar_url} size={18} rounded="rounded-full" />
          <span className="text-[11px] md:text-[10px] text-slate-300 truncate">{t.assignee_name || "Unassigned"}</span>
        </div>

        <div className="col-span-4 md:col-span-2 min-w-0 text-right md:text-left text-[11px] md:text-[10px] font-mono text-slate-400 md:text-slate-500" title={`Assigned ${assignedOn.toLocaleString("en-IN")}`}>
          {assignedOn.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          <span className="text-slate-400 md:text-slate-700"> · {ageDays === 0 ? "today" : `${ageDays}d ago`}</span>
        </div>

        <div className="col-span-12 md:col-span-2 flex items-center justify-between md:justify-end gap-1.5">
          <span className={`flex items-center gap-1 text-[11px] md:text-[10px] font-mono font-bold ${overdue ? "text-red-400" : "text-slate-400 md:text-slate-500"}`}>
            {overdue ? <AlertTriangle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {t.deadline ? new Date(t.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : <span className="text-slate-400 md:text-slate-600 font-normal">no deadline</span>}
          </span>
          {busy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (
            <>
              <select value={t.status} disabled={!!busy} onChange={(e) => patch(t.id, { status: e.target.value })}
                className={`text-[11px] md:text-[9px] font-bold rounded-md px-2 md:px-1.5 py-1.5 md:py-0.5 min-h-[40px] lg:min-h-0 border cursor-pointer focus:outline-none ${STATUS_STYLE[t.status]}`}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
              <button onClick={() => openEdit(t)} disabled={!!busy} title="Edit task"
                className="p-2 lg:p-1 min-h-[40px] min-w-[40px] lg:min-h-0 lg:min-w-0 rounded text-slate-400 md:text-slate-700 hover:text-indigo-400 cursor-pointer disabled:opacity-40">
                <Pencil className="w-3 h-3" />
              </button>
              {canDelete && (
                <button onClick={() => remove(t.id)} disabled={!!busy} title="Delete task"
                  className="p-2 lg:p-1 min-h-[40px] min-w-[40px] lg:min-h-0 lg:min-w-0 rounded text-slate-400 md:text-slate-700 hover:text-rose-400 cursor-pointer disabled:opacity-40">
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {isOpen && taskDetail(t)}
      </div>
    );
  };

  const SORT_LABEL: Record<typeof sortBy, string> = {
    due_asc: "Soonest due first",
    due_desc: "Latest due first",
    assigned_desc: "Newest assigned first",
    assigned_asc: "Oldest assigned first",
    priority: "Priority first",
  };

  const byUrgency = useMemo(() => {
    // A task with no date is not "the year 1970": it sorts last whichever way
    // the dates run, because it is not competing for urgency at all.
    const due = (t: Task) => (t.deadline ? new Date(t.deadline).getTime() : null);
    const byDue = (a: Task, b: Task, dir: 1 | -1) => {
      const x = due(a), y = due(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    };
    const made = (t: Task) => new Date(t.created_at).getTime();
    const prio = (t: Task) => ({ urgent: 0, high: 1, medium: 2, low: 3 }[t.priority] ?? 2);
    const cmp: Record<typeof sortBy, (a: Task, b: Task) => number> = {
      due_asc: (a, b) => byDue(a, b, 1),
      due_desc: (a, b) => byDue(a, b, -1),
      assigned_desc: (a, b) => made(b) - made(a),
      assigned_asc: (a, b) => made(a) - made(b),
      // Equal priorities fall back to soonest due, so the top of the list is
      // still the thing to do next rather than an arbitrary urgent item.
      priority: (a, b) => prio(a) - prio(b) || byDue(a, b, 1),
    };
    return [...filtered].sort(cmp[sortBy]);
  }, [filtered, sortBy]);

  return (
    <div className="space-y-5">
      {/* Board actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-slate-500">Everyone&apos;s work in one place — daily jobs, WhatsApp tasks and client grids.</p>
        <div className="flex items-center gap-2">
          <input ref={sheetInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => e.target.files?.[0] && readSheet(e.target.files[0])} />
          <button onClick={() => sheetInputRef.current?.click()} disabled={scanning}
            title="Attach a photo or screenshot of a job sheet — every row becomes a task"
            className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
            <span>{scanning ? "Reading sheet…" : "Scan sheet"}</span>
          </button>
          <button onClick={() => setShowAdd((s) => !s)} className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white flex items-center space-x-2 cursor-pointer">
            {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}<span>{showAdd ? "Close" : "Add Task"}</span>
          </button>
        </div>
      </div>

      {scanError && (
        <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-3 text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{scanError}</span>
        </div>
      )}

      {/* What the server said no to, in the server's own words. */}
      {actionError && (
        <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-3 text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-white cursor-pointer shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Job sheet review — read from the image, checked by a human before it
          becomes work on the board. */}
      {scan && (
        <div className="bg-slate-950/60 border border-indigo-900/60 rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-indigo-400" />
                <span>{scan.rows.length} job(s) read from the sheet</span>
                {scan.flagged > 0 && (
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-900 text-amber-400">
                    {scan.flagged} need checking
                  </span>
                )}
              </h3>
              {scan.summary && <p className="text-[11px] text-slate-500 mt-0.5">{scan.summary}</p>}
              {scan.clientHint && !scanClient && (
                <p className="text-[11px] text-amber-400 mt-0.5">Sheet names &ldquo;{scan.clientHint}&rdquo; — pick the matching client below.</p>
              )}
              {scan.sheetWarning && <p className="text-[11px] text-amber-400 mt-0.5">{scan.sheetWarning}</p>}
            </div>
            <button onClick={() => setScan(null)} className="text-slate-600 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <div className="min-w-[190px]">
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Client (all rows)</span>
              <select value={scanClient} onChange={(e) => setScanClient(e.target.value)}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Deadline (all rows)</span>
              <input type="date" value={scanDeadline} onChange={(e) => setScanDeadline(e.target.value)}
                className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 focus:outline-none" />
            </div>
            <div className="min-w-[170px]">
              <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Assign all to…</span>
              <select value="" onChange={(e) => e.target.value && setScan({ ...scan, rows: scan.rows.map((r) => ({ ...r, assigneeName: e.target.value })) })}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                <option value="">— pick a person —</option>
                {team.map((m) => <option key={m.id} value={m.name}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
              </select>
            </div>
            {scan.sheetUrl && (
              <a href={scan.sheetUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-400 hover:text-indigo-300 py-2">Open the sheet ↗</a>
            )}
          </div>

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {scan.rows.map((r, i) => {
              const set = (patchRow: Partial<typeof r>) =>
                setScan({ ...scan, rows: scan.rows.map((x, j) => (j === i ? { ...x, ...patchRow } : x)) });
              return (
                <div key={i} className={`rounded-xl border p-2.5 space-y-1.5 ${r.include ? (r.issues.length ? "border-amber-900/60 bg-amber-950/10" : "border-slate-900 bg-slate-950/60") : "border-slate-900/60 bg-slate-950/30 opacity-50"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input type="checkbox" checked={r.include} onChange={(e) => set({ include: e.target.checked })} className="accent-[#FFD400] cursor-pointer" />
                    <input value={r.title} onChange={(e) => set({ title: e.target.value })}
                      className="flex-1 min-w-[150px] text-xs font-semibold bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-indigo-600" />
                    <input value={r.size} onChange={(e) => set({ size: e.target.value })} placeholder="size"
                      className="w-32 text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-300 placeholder-slate-600 focus:outline-none" />
                    <input value={r.qty} onChange={(e) => set({ qty: e.target.value })} placeholder="qty"
                      className="w-16 text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-300 placeholder-slate-600 focus:outline-none" />
                    <select value={r.type} onChange={(e) => set({ type: e.target.value })}
                      className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-1.5 text-slate-400 cursor-pointer focus:outline-none">
                      {["print", "packaging", "design", "video", "other"].map((k) => <option key={k} value={k}>{TYPE_LABEL[k] || k}</option>)}
                    </select>
                    <select value={r.assigneeName} onChange={(e) => set({ assigneeName: e.target.value })}
                      className={`text-[11px] rounded-lg px-1.5 py-1.5 border cursor-pointer focus:outline-none ${r.assigneeName ? "bg-indigo-950/40 border-indigo-900 text-indigo-300" : "bg-slate-950 border-slate-800 text-slate-500"}`}>
                      <option value="">Unassigned</option>
                      {team.map((m) => <option key={m.id} value={m.name}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
                    </select>
                  </div>
                  {r.remark && <p className="text-[10px] text-slate-500 pl-6">{r.remark}</p>}
                  {r.issues.length > 0 && (
                    <p className="text-[10px] text-amber-400 pl-6 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /><span>{r.issues.join(" · ")}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-900">
            <span className="text-[10px] text-slate-600">
              Fix anything flagged before creating — the sheet stays attached to every task either way.
            </span>
            <button onClick={createFromSheet} disabled={creating || scan.rows.every((r) => !r.include)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-2">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Create {scan.rows.filter((r) => r.include).length} task(s)</span>
            </button>
          </div>
        </div>
      )}

      {/* Completed — by designer. Folded away by default: the board is about
          what is left, and this is the answer to the other question, kept one
          click from the top of the page. */}
      {mode === "board" && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl">
          <div className="flex items-center justify-between gap-2 flex-wrap px-3.5 py-2.5">
            <button onClick={toggleCompleted}
              title={completedOpen ? "Hide finished work" : "Show what was finished"}
              className="flex items-center gap-2 min-h-[40px] lg:min-h-0 text-xs font-bold text-white cursor-pointer hover:text-indigo-300">
              <ChevronDown className={`w-3.5 h-3.5 text-indigo-400 transition-transform ${completedOpen ? "rotate-180" : ""}`} />
              <span>Completed — by designer</span>
            </button>
          </div>
          {/* The lone date input is gone: the calendar below IS the date
              picker, and it shows which days are worth picking. */}
          {completedOpen && (
            <div className="px-3.5 pb-3">
              <CompletedCalendar tasks={completedSource} team={team} />
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Open Tasks", value: stats.open, cls: "text-white" },
          { label: "Due Today", value: stats.dueToday, cls: "text-amber-400" },
          { label: "Overdue", value: stats.overdue, cls: "text-red-400" },
          { label: "In Review", value: stats.review, cls: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-950/40 border border-slate-900 rounded-2xl p-3 sm:p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
            <h3 className={`text-xl sm:text-2xl font-extrabold ${s.cls}`}>{s.value}</h3>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Task — e.g. 'suvarna rakhi grid 3 posts'"
            className="md:col-span-2 text-sm md:text-xs min-h-[40px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-600"
          />
          <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="text-sm md:text-xs min-h-[40px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            <option value="">Client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.assigneeName} onChange={(e) => setForm({ ...form, assigneeName: e.target.value })} className="text-sm md:text-xs min-h-[40px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            <option value="">Assign to…</option>
            {team.map((m) => <option key={m.id} value={m.name}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="text-sm md:text-xs min-h-[40px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {priorityToggle(form.priority, (p) => setForm({ ...form, priority: p }))}
          <div className="flex items-center gap-2">
            <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="flex-1 text-sm md:text-xs min-h-[40px] lg:min-h-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 focus:outline-none" />
            <button onClick={addTask} disabled={saving || !form.title.trim()} className="px-3 py-2 min-h-[40px] lg:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
          <div className="md:col-span-6 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={fileRef} type="file" multiple className="hidden"
                onChange={(e) => setPickedFiles(Array.from(e.target.files || []))} />
              <button onClick={() => fileRef.current?.click()} disabled={saving}
                className="inline-flex items-center gap-1.5 min-h-10 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-600 text-[11px] font-bold text-slate-400 hover:text-white cursor-pointer disabled:opacity-50">
                <Paperclip className="w-3.5 h-3.5" /><span>Attach files</span>
              </button>
              <span className="text-[10px] text-slate-600">
                {pickedFiles.length > 0
                  ? `${pickedFiles.length} file(s) — they upload after the task is saved`
                  : "Up to 500MB each — they go straight to Drive, not through the portal."}
              </span>
            </div>
            {pickedFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 truncate min-w-0 flex-1">{f.name} <span className="text-slate-600">{humanSize(f.size)}</span></span>
                {saving && (
                  <span className="w-24 h-1 bg-slate-900 rounded-full overflow-hidden shrink-0">
                    <span className="block h-full bg-[var(--yellow)] transition-all duration-200" style={{ width: `${uploadPct[f.name] || 0}%` }} />
                  </span>
                )}
              </div>
            ))}
            {uploadErrors.map((e, i) => <p key={i} className="text-[10px] text-amber-400">{e}</p>)}
          </div>
          {addSuggestion && form.assigneeName === addSuggestion.name && (
            <p className="md:col-span-6 text-[10px] text-slate-500 -mt-1">
              Suggested: <span className="text-slate-300 font-semibold">{addSuggestion.name}</span> — {addSuggestion.reason}
            </p>
          )}
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
          {team.map((m) => <option key={m.id} value={m.name}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
        </select>
        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="text-[10px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2.5 text-slate-300 cursor-pointer focus:outline-none">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} title="Sort the list"
          className="text-[10px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2.5 text-slate-300 cursor-pointer focus:outline-none">
          <option value="due_asc">Due · soonest first</option>
          <option value="due_desc">Due · latest first</option>
          <option value="assigned_desc">Assigned · newest first</option>
          <option value="assigned_asc">Assigned · oldest first</option>
          <option value="priority">Priority</option>
        </select>
        {mode === "team" && (
          <button
            onClick={pmCanToggle ? togglePm : undefined}
            disabled={pmBusy || !pmCanToggle}
            title={pmCanToggle ? "Only high-confidence matches assign themselves; everything else waits for you." : "Only the founder can change this."}
            className={`flex items-center gap-1.5 min-h-10 px-3 py-2 rounded-xl border text-[10px] font-bold transition-colors disabled:opacity-60 ${
              pmOn ? "bg-emerald-950/40 border-emerald-900 text-emerald-300" : "bg-slate-950 border-slate-900 text-slate-400"
            } ${pmCanToggle ? "cursor-pointer" : "cursor-default"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${pmOn ? "bg-emerald-400" : "bg-slate-700"}`} />
            <span>PM auto-assign — high-confidence tasks assign themselves</span>
            <span className={pmOn ? "text-emerald-400" : "text-slate-600"}>{pmOn ? "ON" : "OFF"}</span>
          </button>
        )}
        <span className="text-[10px] text-slate-600 font-mono ml-auto">{filtered.length} task(s)</span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : mode === "board" && tab !== "done" && filtered.length === 0 ? (
        <p className="text-xs text-slate-600 py-16 text-center">No tasks here. Add one above, or create tasks from the WhatsApp Task Bar.</p>
      ) : null}

      {/* Completed, in both faces. The flat list and the per-member columns of
          finished work are gone — nobody reads a year of finishes backwards.
          A month, and the day you tap on it, is the whole question. */}
      {!loading && tab === "done" && (
        <CompletedCalendar tasks={filtered} team={team} />
      )}

      {/* Board tab: the whole picture — every pending task, soonest due first. */}
      {!loading && mode === "board" && tab !== "done" && filtered.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Rows3 className="w-3.5 h-3.5 text-indigo-400" />
              <span>All pending tasks</span>
              <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{byUrgency.length}</span>
            </h3>
            <span className="text-[10px] text-slate-600">{SORT_LABEL[sortBy]}</span>
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

      {/* Team tab: who is carrying what — every member's whole plate, full width.
          Only ever open work: finished tasks answer to the calendar above. */}
      {!loading && mode === "team" && tab !== "done" && (
        // Below md the columns swipe sideways instead of stacking into one
        // endless scroll; from md it is today's grid, untouched.
        <div className="flex overflow-x-auto snap-x snap-mandatory md:overflow-visible md:grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {columns.map((col) => {
            const late = col.items.filter((t) => t.deadline && new Date(t.deadline).getTime() < now && t.status !== "done").length;
            const isCollapsed = !!collapsed[col.name];
            // Only a permitted drag makes a column a target — without the grant
            // there is nothing in the air and nothing lights up.
            const dropping = canMove && !!dragTask && dragOverCol === col.name;
            return (
              <div key={col.name}
                // preventDefault on dragover is what PERMITS a drop at all, so
                // it cannot wait on dragTask state — gate on the grant alone.
                onDragOver={canMove ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverCol(col.name); } : undefined}
                onDragLeave={canMove ? () => setDragOverCol((c) => (c === col.name ? null : c)) : undefined}
                onDrop={canMove ? (e) => { e.preventDefault(); dropOnColumn(col.name, e.dataTransfer.getData("text/plain")); } : undefined}
                className={`w-72 shrink-0 snap-start md:w-auto border rounded-2xl bg-slate-950/50 transition-shadow ${late > 0 ? "border-rose-900/50" : "border-slate-900"} ${dropping ? "ring-2 ring-indigo-500" : ""}`}>
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
                {/* Availability. Team member rows are made in the database, but
                    whether someone is on leave changes weekly — so this one
                    field is editable where the founder is already looking. */}
                {col.member && (
                  <div className="flex items-center gap-1.5 px-3.5 pb-2 -mt-1 flex-wrap">
                    {awayLabel(col.member.away_until) && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-900 text-amber-400">
                        {awayLabel(col.member.away_until)}
                      </span>
                    )}
                    <input
                      type="date"
                      value={col.member.away_until || ""}
                      onChange={(e) => setAway(col.member!.id, e.target.value || null)}
                      title="Away until — they stay assignable, but everyone can see they're out"
                      className="min-h-10 text-[10px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-400 cursor-pointer [color-scheme:dark] focus:outline-none focus:border-indigo-600"
                    />
                    {col.member.away_until && (
                      <button onClick={() => setAway(col.member!.id, null)} title="They're back"
                        className="text-[9px] font-bold text-slate-600 hover:text-white cursor-pointer px-1">clear</button>
                    )}
                    {profiles[col.name.toLowerCase().trim()] && (
                      <button onClick={() => setOpenProfile((p) => (p === col.name ? null : col.name))}
                        title="Their last 60 days"
                        className="text-[9px] font-bold text-slate-600 hover:text-indigo-400 cursor-pointer px-1 ml-auto">
                        {openProfile === col.name ? "hide" : "profile"}
                      </button>
                    )}
                  </div>
                )}

                {/* Two months of facts, opened on request so the header stays a
                    header. Numbers only — nothing here ranks anybody. */}
                {openProfile === col.name && profiles[col.name.toLowerCase().trim()] && (() => {
                  const p = profiles[col.name.toLowerCase().trim()];
                  const stat = (label: string, value: string) => (
                    <span key={label} className="text-[9px] text-slate-500">
                      {label} <span className="text-slate-300 font-bold font-mono">{value}</span>
                    </span>
                  );
                  return (
                    <div className="mx-3.5 mb-2 px-2.5 py-2 rounded-lg bg-slate-950/80 border border-slate-900 space-y-1">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {stat("open", String(p.openLoad))}
                        {stat("done 60d", String(p.doneCount))}
                        {stat("on time", p.onTimePct === null ? "—" : `${p.onTimePct}%`)}
                        {stat("QC pass", p.qcPassPct === null ? "—" : `${p.qcPassPct}%`)}
                      </div>
                      {p.speed.length > 0 && (
                        <p className="text-[9px] text-slate-500">
                          typically {p.speed.map((sp) => `${TYPE_LABEL[sp.type] || sp.type} ${sp.medianDays}d`).join(" · ")}
                        </p>
                      )}
                      {p.topClients.length > 0 && (
                        <p className="text-[9px] text-slate-600 truncate">
                          mostly {p.topClients.map((c) => `${c.name} (${c.count})`).join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {!isCollapsed && (col.items.length === 0 ? (
                  <p className="text-[10px] text-slate-600 px-3.5 pb-2.5">No open tasks.</p>
                ) : (
                  <div className="px-2.5 pb-2.5 space-y-1">
                    {col.items.map((t) => {
                      const overdue = !!t.deadline && new Date(t.deadline).getTime() < now && t.status !== "done";
                      const isOpen = !!expanded[t.id];
                      return (
                        <div key={t.id}
                          draggable={canMove}
                          // setData must happen inside the event, but the state
                          // write is DEFERRED: re-rendering the dragged node
                          // while dragstart is still settling makes Chrome
                          // cancel the whole drag on the spot.
                          onDragStart={canMove ? (e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", t.id);
                            window.setTimeout(() => setDragTask(t.id), 0);
                          } : undefined}
                          onDragEnd={canMove ? () => { setDragTask(null); setDragOverCol(null); } : undefined}
                          title={canMove ? "Drag onto another person to hand it over" : undefined}
                          className={`rounded-lg border ${isUrgent(t)
                            ? "border-rose-900/60 border-l-2 border-l-rose-500 bg-rose-950/10"
                            : "bg-slate-950/60 border-slate-900/70"} ${canMove ? "cursor-grab active:cursor-grabbing" : ""} ${dragTask === t.id ? "opacity-40" : ""}`}>
                        <div className="flex items-center gap-2 text-[10px] px-2 py-1.5">
                          <button onClick={() => toggleExpanded(t.id)} title={isOpen ? "Hide the full task" : "Show the full task"}
                            className="shrink-0 -ml-1 p-1 rounded text-slate-600 hover:text-indigo-400 cursor-pointer">
                            <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </button>
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.medium}`} />
                          {/* A floor on the title: in a w-72 column the date, status
                              and buttons would otherwise squeeze it out of the row. */}
                          <button onClick={() => toggleExpanded(t.id)} title={t.title || ""}
                            className="min-w-[64px] flex-1 text-left text-slate-300 truncate py-1.5 -my-1.5 hover:text-indigo-300 cursor-pointer">
                            {t.title || "Untitled"}
                          </button>
                          {t.clients?.name && <span className="text-slate-600 truncate max-w-[80px]">{t.clients.name}</span>}
                          {isUrgent(t) && <UrgentChip />}
                          <RescheduleBadge n={t.reschedule_count} />
                          <span className={`font-mono shrink-0 ${overdue ? "text-rose-400 font-bold" : "text-slate-500"}`}>
                            {t.deadline ? new Date(t.deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
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
                          {canDelete && (
                            <button onClick={() => remove(t.id)} disabled={!!busy} title="Delete task"
                              className="p-0.5 rounded text-slate-700 hover:text-rose-400 cursor-pointer disabled:opacity-40 shrink-0">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {isOpen && taskDetail(t)}
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
                {/* Changing the name here is the same act as dragging the card,
                    so it asks for the same grant. Without it the name is a fact
                    to read, not a field. */}
                {canMove ? (
                  <select value={editForm.assigneeName} onChange={(e) => setEditForm({ ...editForm, assigneeName: e.target.value })}
                    className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 cursor-pointer focus:outline-none">
                    <option value="">Unassigned</option>
                    {team.map((m) => <option key={m.id} value={m.name}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
                  </select>
                ) : (
                  <p title="Only the founder, or someone they've granted it to, can move tasks between people."
                    className="w-full text-xs bg-slate-950/60 border border-slate-900 rounded-lg px-2 py-2 text-slate-400 truncate">
                    {editForm.assigneeName || "Unassigned"}
                  </p>
                )}
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
                {priorityToggle(editForm.priority, (p) => setEditForm({ ...editForm, priority: p }))}
              </div>
              <div className="col-span-2">
                <span className="text-[9px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-2">
                  <span>Deadline</span>
                  <RescheduleBadge n={editTask.reschedule_count} />
                </span>
                <input type="date" value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-300 focus:outline-none" />
                <p className="text-[9px] text-slate-600 mt-1">Leave empty when there is no fixed date — set one when it&apos;s urgent.</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              {canDelete ? (
                <button onClick={() => { const id = editTask.id; setEditTask(null); remove(id); }} disabled={!!busy}
                  className="px-3 py-2 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-400 text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  <Trash2 className="w-3 h-3" /><span>Delete</span>
                </button>
              ) : <span />}
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
