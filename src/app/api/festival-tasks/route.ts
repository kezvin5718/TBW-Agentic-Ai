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

/**
 * POST — put clients on a festival. Body: { festivalId, clientIds: [] }
 *
 * Each new client gets a real task first, then the festival row that points at
 * it. Adding the same client twice is a thing people do, so clients already on
 * this festival are skipped before any task is made for them.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { festivalId, clientIds } = await request.json();
  const asked = [...new Set((Array.isArray(clientIds) ? clientIds : []).filter((c): c is string => typeof c === "string" && !!c))];
  if (!festivalId) return NextResponse.json({ error: "festivalId required" }, { status: 400 });
  if (asked.length === 0) return NextResponse.json({ error: "Pick at least one client." }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data: festival } = await admin.from("festivals").select("name, scheduled_at").eq("id", festivalId).maybeSingle();
  if (!festival) return NextResponse.json({ error: "That festival no longer exists." }, { status: 404 });

  const [{ data: existing }, { data: clientRows }] = await Promise.all([
    admin.from("festival_tasks").select("client_id").eq("festival_id", festivalId),
    admin.from("clients").select("id, name").in("id", asked),
  ]);
  const already = new Set((existing || []).map((r) => r.client_id as string));
  const names = new Map((clientRows || []).map((c) => [c.id as string, c.name as string]));
  const fresh = asked.filter((id) => !already.has(id) && names.has(id));

  if (fresh.length === 0) {
    return NextResponse.json({ success: true, added: 0, message: "Those clients were already on this festival." });
  }

  // The festival's own date is the deadline; a festival with no date on it
  // still needs the work to land somewhere, so a week out.
  const deadline = festival.scheduled_at
    ? new Date(festival.scheduled_at as string).toISOString()
    : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const { data: madeTasks, error: taskErr } = await admin
    .from("tasks")
    .insert(fresh.map((clientId) => ({
      title: `${festival.name} — ${names.get(clientId)}`,
      description: null,
      client_id: clientId,
      type: "design",
      priority: "medium",
      status: "todo",
      deadline,
      source: "festival",
      assignee_name: null,
      metadata: { festival_id: festivalId },
    })))
    .select("id, client_id");
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });

  const taskByClient = new Map((madeTasks || []).map((t) => [t.client_id as string, t.id as string]));
  const { data: madeRows, error: rowErr } = await admin
    .from("festival_tasks")
    .insert(fresh.map((clientId) => ({
      festival_id: festivalId,
      client_id: clientId,
      task_id: taskByClient.get(clientId) || null,
      status: "todo",
    })))
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
