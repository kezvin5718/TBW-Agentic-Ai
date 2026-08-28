import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

// Link team_members without a login to a matching profile by name, then
// backfill tasks.assignee_id so "My Tasks" lights up the day someone signs up.
async function syncMemberProfiles(admin: ReturnType<typeof createServiceRoleClient>) {
  const { data: unlinked } = await admin.from("team_members").select("id, name").is("profile_id", null).eq("active", true);
  if (!unlinked || unlinked.length === 0) return;
  const { data: profiles } = await admin.from("profiles").select("id, name").in("role", ["founder", "employee"]);
  if (!profiles || profiles.length === 0) return;

  for (const member of unlinked) {
    const m = (member.name || "").trim().toLowerCase();
    if (!m) continue;
    // Board names are first names ("Yashpal"); logins are full names, and the
    // surname isn't always last ("Thakur Yashpal Singh"), so match any word.
    const match = profiles.find((p) => {
      const pn = (p.name || "").trim().toLowerCase();
      return pn === m || pn.split(/\s+/).includes(m);
    });
    if (match) {
      await admin.from("team_members").update({ profile_id: match.id }).eq("id", member.id);
      await admin.from("tasks").update({ assignee_id: match.id })
        .ilike("assignee_name", member.name).is("assignee_id", null);
    }
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
    .select("id, title, description, type, status, priority, deadline, source, assignee_name, assignee_id, client_id, created_at, completed_at, clients(name)")
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

  return NextResponse.json({ success: true, tasks: tasksWithFiles, team: teamWithPhotos, clients: clients || [], canDelete: await mayDeleteTasks(user.id, role) });
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
  const { user } = await requireStaff();
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
  if (body.assigneeName !== undefined) {
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
  if (body.deadline !== undefined) patch.deadline = body.deadline ? new Date(body.deadline).toISOString() : null;
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
