import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { utcToIstWallClock } from "@/lib/time";

export const dynamic = "force-dynamic";

/** How many times a task may be pushed before the board stops helping. */
const RESCHEDULE_CAP = 50;

/**
 * The Indian calendar day an instant falls on, "YYYY-MM-DD".
 *
 * A deadline nudged from 9am to 6pm on the same day is not a reschedule — it is
 * the same day's work. Only the day matters, and only the Indian one: compared
 * in UTC, anything set before 5:30am reads as the day before.
 */
function istDay(instant: string | Date): string {
  return utcToIstWallClock(instant).slice(0, 10);
}

const TASK_TYPES = ["copy", "image", "video", "ads", "design", "video_edit", "ai_video", "script", "planning", "packaging", "print", "other"];
const STATUSES = ["todo", "in_progress", "review", "done"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) return { user: null, role };
  return { user, role };
}

// Two-way sync between the board's members and portal logins.
// Forward: a board row without a login links to a matching profile by name,
// and that person's old tasks pick up assignee_id, so "My Tasks" lights up
// the day they sign up. Reverse: an employee login with no board row gets
// one — without it, a hire added in Team & Access can never be assigned.
async function syncMemberProfiles(admin: ReturnType<typeof createServiceRoleClient>) {
  const [{ data: members }, { data: profiles }] = await Promise.all([
    admin.from("team_members").select("id, name, profile_id, active"),
    admin.from("profiles").select("id, name, role").in("role", ["founder", "employee"]),
  ]);
  if (!profiles || profiles.length === 0) return;
  const all = members || [];

  for (const member of all.filter((m) => !m.profile_id && m.active)) {
    const m = (member.name || "").trim().toLowerCase();
    if (!m) continue;
    // Board names are first names ("Yashpal"); logins are full names, and the
    // surname isn't always last ("Thakur Yashpal Singh"), so match any word.
    const match = profiles.find((p) => {
      const pn = (p.name || "").trim().toLowerCase();
      return pn === m || pn.split(/\s+/).includes(m);
    });
    if (match) {
      member.profile_id = match.id;
      await admin.from("team_members").update({ profile_id: match.id }).eq("id", member.id);
      await admin.from("tasks").update({ assignee_id: match.id })
        .ilike("assignee_name", member.name).is("assignee_id", null);
    }
  }

  // Reverse direction: employee logins nobody put on the board yet.
  const linked = new Set(all.map((m) => m.profile_id).filter(Boolean));
  for (const p of profiles) {
    if (p.role !== "employee" || linked.has(p.id)) continue;
    const pn = (p.name || "").trim();
    const words = pn.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // Skip anyone already on the board under a shorter or differently-spaced
    // name — including deactivated rows: switched off stays switched off, and
    // a second login for the same person must not become a second column.
    const known = all.some((m) => {
      const mn = (m.name || "").trim().toLowerCase();
      return !!mn && (mn === words.join(" ") || words.includes(mn) || mn.replace(/\s+/g, "") === words.join(""));
    });
    if (known) continue;
    await admin.from("team_members").insert({ name: pn, profile_id: p.id, active: true });
  }
}

// GET — the team task board. ?status=open|done|all &assignee=<name> &client=<uuid>
export async function GET(request: NextRequest) {
  const { user, role } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  await syncMemberProfiles(admin);

  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "open";
  const assignee = params.get("assignee");
  const client = params.get("client");

  let q = admin
    .from("tasks")
    .select("id, title, description, type, status, priority, deadline, source, assignee_name, assignee_id, client_id, created_at, completed_at, reschedule_count, clients(name)")
    .is("plan_id", null)
    .order("priority", { ascending: false })
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(500);

  if (status === "open") q = q.neq("status", "done");
  else if (status === "done") q = q.eq("status", "done");
  if (assignee === "unassigned") q = q.is("assignee_name", null);
  else if (assignee) q = q.ilike("assignee_name", assignee);
  if (client) q = q.eq("client_id", client);

  const [{ data: tasks, error }, { data: team }, { data: clients }] = await Promise.all([
    q,
    admin.from("team_members").select("id, name, role_title, profile_id, away_until").eq("active", true).order("name"),
    admin.from("clients").select("id, name").order("name"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach each member's profile photo/designation so the board can show faces.
  const { data: profs } = await admin.from("profiles").select("id, avatar_url, designation");
  const byProfile = new Map((profs || []).map((p) => [p.id, p]));
  const teamWithPhotos = (team || []).map((m) => {
    const prof = m.profile_id ? byProfile.get(m.profile_id) : null;
    return { ...m, avatar_url: prof?.avatar_url || null, role_title: m.role_title || prof?.designation || null };
  });

  // Attachments in one keyed query rather than a join: the task list is already
  // shaped and most tasks have none.
  const taskIds = (tasks || []).map((t) => t.id as string);
  const { data: files } = taskIds.length
    ? await admin.from("task_attachments").select("id, task_id, file_name, mime, size_bytes, url, created_at").in("task_id", taskIds).order("created_at")
    : { data: [] };
  const filesByTask = new Map<string, unknown[]>();
  for (const f of files || []) {
    const list = filesByTask.get(f.task_id as string) || [];
    list.push(f);
    filesByTask.set(f.task_id as string, list);
  }
  const tasksWithFiles = (tasks || []).map((t) => ({ ...t, attachments: filesByTask.get(t.id as string) || [] }));

  return NextResponse.json({
    success: true, tasks: tasksWithFiles, team: teamWithPhotos, clients: clients || [],
    canDelete: await mayDeleteTasks(user.id, role),
    canMove: await mayMoveTasks(user.id, role),
  });
}

// POST — create a task. Body: { title, description?, clientId?, type?, assigneeName?, priority?, deadline? }
export async function POST(request: NextRequest) {
  const { user } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const title = (body.title || "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const type = TASK_TYPES.includes(body.type) ? body.type : "other";
  const priority = PRIORITIES.includes(body.priority) ? body.priority : "medium";
  // A blank deadline is now a real answer, not a missing one: the modal offers
  // it deliberately. Bots always send a date, so they are unaffected.
  const deadline = body.deadline ? new Date(body.deadline).toISOString() : null;

  const admin = createServiceRoleClient();
  let assigneeId: string | null = null;
  const assigneeName: string | null = (body.assigneeName || "").trim() || null;
  if (assigneeName) {
    const { data: member } = await admin.from("team_members").select("profile_id").ilike("name", assigneeName).maybeSingle();
    assigneeId = member?.profile_id || null;
  }

  const { data, error } = await admin.from("tasks").insert({
    title,
    description: (body.description || "").trim() || null,
    client_id: body.clientId || null,
    type,
    priority,
    status: "todo",
    deadline,
    source: "manual",
    assignee_name: assigneeName,
    assignee_id: assigneeId,
    metadata: { created_by: user.id },
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}

// PATCH — update a task. Body: { id, status?, assigneeName?, priority?, deadline?, title?, clientId?, type? }
export async function PATCH(request: NextRequest) {
  const { user, role } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    patch.status = body.status;
    patch.completed_at = body.status === "done" ? new Date().toISOString() : null;
  }
  // Handing work to someone else — by drag, or by the modal's dropdown — is the
  // one edit that needs the named grant. The name and the profile id move
  // together: a name nobody has a board row for writes the name and a null id,
  // exactly as creating a task does.
  if (body.assigneeName !== undefined) {
    if (!(await mayMoveTasks(user.id, role))) {
      return NextResponse.json({ error: "You don't have permission to move tasks between people — ask the founder to grant it in Team & Access." }, { status: 403 });
    }
    const name = (body.assigneeName || "").trim() || null;
    patch.assignee_name = name;
    patch.assignee_id = null;
    if (name) {
      const { data: member } = await admin.from("team_members").select("profile_id").ilike("name", name).maybeSingle();
      patch.assignee_id = member?.profile_id || null;
    }
  }
  if (body.priority !== undefined && PRIORITIES.includes(body.priority)) patch.priority = body.priority;
  if (body.type !== undefined && TASK_TYPES.includes(body.type)) patch.type = body.type;
  // Explicit null clears it; absent leaves it alone.
  //
  // A deadline pushed to a LATER Indian day is a reschedule, and the count is
  // kept here rather than trusted from the client — it is the one number on the
  // task nobody may edit. Pulling a date forward costs nothing. A dateless task
  // gaining its first date is only a reschedule when the caller SAID so
  // (body.reschedule, the board's Reschedule button): half the board's tasks
  // are born without deadlines, and "I'll do it tomorrow" on one of those is
  // exactly the push the founder wants counted.
  if (body.deadline !== undefined) {
    const next = body.deadline ? new Date(body.deadline).toISOString() : null;
    patch.deadline = next;
    const { data: before } = await admin.from("tasks").select("deadline, reschedule_count").eq("id", body.id).maybeSingle();
    const was = before?.deadline ? istDay(before.deadline as string) : null;
    const now = next ? istDay(next) : null;
    if (now && (was ? now > was : body.reschedule === true)) {
      const count = Number(before?.reschedule_count) || 0;
      if (count >= RESCHEDULE_CAP) {
        return NextResponse.json({ error: `This task has been rescheduled ${RESCHEDULE_CAP} times — it cannot be pushed again. Finish it or delete it.` }, { status: 400 });
      }
      patch.reschedule_count = count + 1;
    }
  }
  if (body.title !== undefined && (body.title || "").trim()) patch.title = body.title.trim();
  if (body.clientId !== undefined) patch.client_id = body.clientId || null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await admin.from("tasks").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * Who may delete a task. Founders always; employees only when the founder has
 * granted it to them by name in Team & Access (profiles.can_delete_tasks).
 * Deletion is unrecoverable, so it stays a named grant rather than a role-wide
 * one — most of the team should be able to edit and complete, not erase.
 */
async function mayDeleteTasks(userId: string, role: string): Promise<boolean> {
  if (role === "founder") return true;
  if (role !== "employee") return false;
  const admin = createServiceRoleClient();
  const { data } = await admin.from("profiles").select("can_delete_tasks").eq("id", userId).maybeSingle();
  return !!data?.can_delete_tasks;
}

/**
 * Who may move a task onto another person's name. Founders always; employees
 * only by named grant (profiles.can_move_tasks), the same shape as deletion.
 * Reassignment isn't destructive, but it decides someone else's day — so it
 * stays a decision the founder hands out, not one the whole team holds.
 */
async function mayMoveTasks(userId: string, role: string): Promise<boolean> {
  if (role === "founder") return true;
  if (role !== "employee") return false;
  const admin = createServiceRoleClient();
  const { data } = await admin.from("profiles").select("can_move_tasks").eq("id", userId).maybeSingle();
  return !!data?.can_move_tasks;
}

// DELETE — remove a task. Body: { id }
export async function DELETE(request: NextRequest) {
  const { user, role } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await mayDeleteTasks(user.id, role))) {
    return NextResponse.json({ error: "You don't have permission to delete tasks — ask the founder to grant it in Team & Access." }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("tasks").delete().eq("id", id).is("plan_id", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
