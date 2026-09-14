import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The task board's vocabulary, because the task row is what holds the status. */
const STATUSES = ["todo", "in_progress", "review", "done"];

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * One row per client per festival — the list the team works through when Diwali
 * is coming and every brand needs its own creative.
 *
 * Every festival row owns a real task on the Team Task board, and THAT TASK IS
 * AUTHORITATIVE for status, assignee and deadline. This table keeps only what
 * is particular to a festival: which festival, which client, and the line that
 * client's creative carries. Nothing is mirrored back from the task, because
 * two copies of a status is two statuses that will eventually disagree.
 */

/** The status a row is really at — the task's, and only then its own column. */
interface JoinedTask { id: string; status: string | null; assignee_name: string | null; deadline: string | null }
function taskOf(row: { tasks?: JoinedTask | JoinedTask[] | null }): JoinedTask | null {
  const t = row.tasks;
  if (!t) return null;
  return Array.isArray(t) ? t[0] || null : t;
}

/** GET ?festivalId= — every client on this festival. */
export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const festivalId = new URL(request.url).searchParams.get("festivalId");
  if (!festivalId) return NextResponse.json({ error: "festivalId required" }, { status: 400 });

  const admin = createServiceRoleClient();
  // Ordering by the client's name belongs to the embedded table and cannot
  // order these rows, and the status now lives on the task — so the board does
  // the arranging and this only needs to be stable.
  const { data, error } = await admin
    .from("festival_tasks")
    .select("*, clients(name), tasks:task_id(id, status, assignee_name, deadline)")
    .eq("festival_id", festivalId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (data || []).map((row) => {
    const task = taskOf(row);
    return {
      ...row,
      // A row whose task was deleted falls back to its own column rather than
      // disappearing from the board.
      status: task?.status || row.status || "todo",
      assignee_name: task?.assignee_name ?? row.assignee_name,
      deadline: task?.deadline ?? null,
    };
  });

  return NextResponse.json({ success: true, tasks });
}

/** One client's place on a festival, as the Add panel decides it. */
interface Allotment { clientId: string; teamMemberId: string | null; tagline: string | null }

/**
 * What the caller asked for, in one shape.
 *
 * The Add panel now sends the whole decision — client, designer, line — but the
 * old bare `clientIds` is still a valid way to ask, and answers exactly as it
 * always did: nobody named, nothing written, the PM left to suggest. First
 * mention of a client wins, because a list someone built by clicking can name
 * the same brand twice.
 */
function readAllotments(clients: unknown, clientIds: unknown): Allotment[] {
  const raw: Allotment[] = Array.isArray(clients)
    ? clients.map((c) => {
        const e = (c || {}) as Record<string, unknown>;
        return {
          clientId: typeof e.clientId === "string" ? e.clientId : "",
          teamMemberId: typeof e.teamMemberId === "string" && e.teamMemberId ? e.teamMemberId : null,
          tagline: String(e.tagline || "").trim().slice(0, 300) || null,
        };
      })
    : (Array.isArray(clientIds) ? clientIds : []).map((id) => ({
        clientId: typeof id === "string" ? id : "",
        teamMemberId: null,
        tagline: null,
      }));

  const seen = new Set<string>();
  return raw.filter((a) => {
    if (!a.clientId || seen.has(a.clientId)) return false;
    seen.add(a.clientId);
    return true;
  });
}

/**
 * POST — put clients on a festival.
 * Body: { festivalId, clients: [{ clientId, teamMemberId?, tagline? }] }
 *    or { festivalId, clientIds: [] }
 *
 * Each new client gets a real task first, then the festival row that points at
 * it. Adding the same client twice is a thing people do, so clients already on
 * this festival are skipped before any task is made for them.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { festivalId, clientIds, clients } = await request.json();
  const asked = readAllotments(clients, clientIds);
  if (!festivalId) return NextResponse.json({ error: "festivalId required" }, { status: 400 });
  if (asked.length === 0) return NextResponse.json({ error: "Pick at least one client." }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data: festival } = await admin.from("festivals").select("name, scheduled_at").eq("id", festivalId).maybeSingle();
  if (!festival) return NextResponse.json({ error: "That festival no longer exists." }, { status: 404 });

  const [{ data: existing }, { data: clientRows }] = await Promise.all([
    admin.from("festival_tasks").select("client_id").eq("festival_id", festivalId),
    admin.from("clients").select("id, name").in("id", asked.map((a) => a.clientId)),
  ]);
  const already = new Set((existing || []).map((r) => r.client_id as string));
  const names = new Map((clientRows || []).map((c) => [c.id as string, c.name as string]));
  const fresh = asked.filter((a) => !already.has(a.clientId) && names.has(a.clientId));

  if (fresh.length === 0) {
    return NextResponse.json({ success: true, added: 0, message: "Those clients were already on this festival." });
  }

  // The creative has to be ready before the day itself, so the deadline sits
  // two days ahead of the festival. A festival that is already nearly here
  // cannot ask for work in the past, so it asks for it now. A festival with no
  // date on it still needs the work to land somewhere, so a week out.
  const twoDaysBefore = festival.scheduled_at
    ? new Date(festival.scheduled_at as string).getTime() - 2 * 24 * 3600 * 1000
    : null;
  const deadline = twoDaysBefore !== null
    ? new Date(Math.max(twoDaysBefore, Date.now())).toISOString()
    : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  // tasks.assignee_id is a PROFILE id, not a team_members id — Team & Access
  // links the two, and a member with no login simply has no profile. Every
  // named designer is looked up once, here, rather than per row.
  const memberIds = [...new Set(fresh.map((a) => a.teamMemberId).filter((id): id is string => !!id))];
  const members = new Map<string, { name: string | null; profileId: string | null }>();
  if (memberIds.length > 0) {
    const { data: memberRows } = await admin.from("team_members").select("id, name, profile_id").in("id", memberIds);
    for (const m of memberRows || []) {
      members.set(m.id as string, { name: (m.name as string | null) || null, profileId: (m.profile_id as string | null) || null });
    }
  }
  /** A designer the panel named but Team & Access no longer knows is nobody. */
  const chosen = (a: Allotment) => (a.teamMemberId ? members.get(a.teamMemberId) || null : null);

  const { data: madeTasks, error: taskErr } = await admin
    .from("tasks")
    .insert(fresh.map((a) => {
      const who = chosen(a);
      return {
        title: `${festival.name} — ${names.get(a.clientId)}`,
        // The designer reads the line on their own board, not on this one.
        description: a.tagline,
        client_id: a.clientId,
        type: "design",
        priority: "medium",
        status: "todo",
        deadline,
        source: "festival",
        // Team Tasks groups its columns by this name, so it is what files the
        // row under the right designer.
        assignee_name: who?.name || null,
        assignee_id: who?.profileId || null,
        metadata: { festival_id: festivalId },
      };
    }))
    .select("id, client_id");
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });

  const taskByClient = new Map((madeTasks || []).map((t) => [t.client_id as string, t.id as string]));
  const { data: madeRows, error: rowErr } = await admin
    .from("festival_tasks")
    .insert(fresh.map((a) => {
      const who = chosen(a);
      return {
        festival_id: festivalId,
        client_id: a.clientId,
        task_id: taskByClient.get(a.clientId) || null,
        status: "todo",
        tagline: a.tagline,
        team_member_id: who ? a.teamMemberId : null,
        assignee_name: who?.name || null,
      };
    }))
    .select("id, client_id");
  if (rowErr) {
    // Never leave tasks on the board for festival rows that failed to exist.
    await admin.from("tasks").delete().in("id", [...taskByClient.values()]);
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }

  // Both directions resolvable: the festival row points at its task, and the
  // task carries the festival row it came from.
  for (const row of madeRows || []) {
    const taskId = taskByClient.get(row.client_id as string);
    if (!taskId) continue;
    await admin.from("tasks")
      .update({ metadata: { festival_id: festivalId, festival_task_id: row.id } })
      .eq("id", taskId);
  }

  // A designer a person chose is never second-guessed, so the PM is only asked
  // about the rows that arrived empty; those it may name when it is certain,
  // and otherwise leaves for the board.
  const { autoAssignTask } = await import("@/lib/pm-auto-assign");
  for (const a of fresh) {
    if (a.teamMemberId) continue;
    const taskId = taskByClient.get(a.clientId);
    if (!taskId) continue;
    const put = await autoAssignTask({ taskId, title: `${festival.name} — ${names.get(a.clientId)}`, clientId: a.clientId, taskType: "design" });
    // The festival row keeps its own copy of who is on it; without this the
    // board would offer to assign someone the task already has.
    if (put) {
      await admin.from("festival_tasks")
        .update({ team_member_id: put.teamMemberId, assignee_name: put.name })
        .eq("festival_id", festivalId)
        .eq("client_id", a.clientId);
    }
  }

  const added = (madeRows || []).length;
  return NextResponse.json({
    success: true,
    added,
    message: `${added} client${added === 1 ? "" : "s"} added.`,
  });
}

/**
 * PATCH — edit one row. Body: { id, tagline?, teamMemberId?, assigneeName?, status? }
 *
 * Status goes to the task and stays there. The tagline and the assignee are
 * written to both, because the festival board is where they are chosen and the
 * designer's own board is where they have to be read.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id, tagline, teamMemberId, assigneeName, status } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (status !== undefined && !STATUSES.includes(String(status))) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("festival_tasks").select("id, task_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "That festival row no longer exists." }, { status: 404 });

  const festivalPatch: Record<string, unknown> = {};
  const taskPatch: Record<string, unknown> = {};

  if (tagline !== undefined) {
    const clean = String(tagline || "").trim().slice(0, 300) || null;
    festivalPatch.tagline = clean;
    // The designer reads the line on their own board, not on this one.
    taskPatch.description = clean;
  }

  if (teamMemberId !== undefined || assigneeName !== undefined) {
    const memberId = teamMemberId || null;
    let name = assigneeName !== undefined ? String(assigneeName || "").trim().slice(0, 120) || null : null;
    // tasks.assignee_id is a PROFILE id, not a team_members id — Team & Access
    // links the two, and a member with no login simply has no profile.
    let profileId: string | null = null;
    if (memberId) {
      const { data: member } = await admin.from("team_members").select("name, profile_id").eq("id", memberId).maybeSingle();
      if (member) {
        profileId = (member.profile_id as string | null) || null;
        if (assigneeName === undefined) name = (member.name as string | null) || null;
      }
    }
    if (teamMemberId !== undefined) festivalPatch.team_member_id = memberId;
    festivalPatch.assignee_name = name;
    // Team Tasks groups its columns by this name, so it is what files the row
    // under the right designer.
    taskPatch.assignee_name = name;
    taskPatch.assignee_id = profileId;
  }

  if (status !== undefined) {
    taskPatch.status = status;
    taskPatch.completed_at = status === "done" ? new Date().toISOString() : null;
  }

  if (Object.keys(festivalPatch).length === 0 && Object.keys(taskPatch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  if (Object.keys(festivalPatch).length > 0) {
    const { error } = await admin.from("festival_tasks").update(festivalPatch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (Object.keys(taskPatch).length > 0) {
    if (!row.task_id) {
      return NextResponse.json({ error: "This festival row has no task behind it — remove it and add the client again." }, { status: 409 });
    }
    const { error } = await admin.from("tasks").update(taskPatch).eq("id", row.task_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE — take a client off this festival, and its task with it. Body: { id } */
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("festival_tasks").select("task_id").eq("id", id).maybeSingle();

  const { error } = await admin.from("festival_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The task exists only because the festival row did; taking the client off
  // the festival must not leave its work sitting on someone's board.
  if (row?.task_id) await admin.from("tasks").delete().eq("id", row.task_id);

  return NextResponse.json({ success: true });
}
