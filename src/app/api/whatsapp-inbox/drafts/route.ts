import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runWhatsAppTaskBot } from "@/lib/wa-task-bot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TASK_TYPES = ["copy", "image", "video", "ads", "design", "video_edit", "ai_video", "script", "planning", "packaging", "print", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) return null;
  return Object.assign(user, { isFounder: role === "founder" });
}

/**
 * A draft from a call belongs to whoever recorded it — their call, their
 * approval. WhatsApp drafts have no owner and stay open to any staff member,
 * which is how they already work. The founder can act on everything.
 */
function mayApprove(draft: { owner_id?: string | null }, user: { id: string; isFounder: boolean }) {
  if (user.isFounder) return true;
  return !draft.owner_id || draft.owner_id === user.id;
}

// GET — pending drafts, each with the exact messages the bot read.
export async function GET(request: NextRequest) {
  const user = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = new URL(request.url).searchParams.get("status") || "pending";
  const admin = createServiceRoleClient();

  let q = admin
    .from("wa_task_drafts")
    .select("*, clients(name)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(50);
  // A manager sees their own calls' drafts plus the shared WhatsApp ones —
  // never another person's call.
  if (!user.isFounder) q = q.or(`owner_id.is.null,owner_id.eq.${user.id}`);

  const { data: drafts, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pull the source messages in one go so the approver can see what was read.
  const allIds = [...new Set((drafts || []).flatMap((d) => d.source_message_ids || []))];
  const { data: msgs } = allIds.length
    ? await admin.from("wa_inbox").select("id, sender_name, message_text, received_at").in("id", allIds)
    : { data: [] };
  const byId = new Map((msgs || []).map((m) => [m.id, m]));

  return NextResponse.json({
    success: true,
    drafts: (drafts || []).map((d) => ({
      ...d,
      messages: (d.source_message_ids || [])
        .map((id: string) => byId.get(id))
        .filter(Boolean)
        .sort((a: { received_at: string }, b: { received_at: string }) => a.received_at.localeCompare(b.received_at)),
    })),
  });
}

// POST — run the bot now (action: "run"), or approve / reject a draft.
// Approving may carry edits: { title, description, clientId, taskType, priority, assignee, deadline }
export async function POST(request: NextRequest) {
  const user = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const admin = createServiceRoleClient();

  if (body.action === "run") {
    const result = await runWhatsAppTaskBot();
    return NextResponse.json({ success: true, ...result });
  }

  if (!body.id) return NextResponse.json({ error: "Draft id required" }, { status: 400 });

  const { data: draft } = await admin.from("wa_task_drafts").select("*").eq("id", body.id).single();
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!mayApprove(draft, user)) {
    return NextResponse.json({ error: "This came from someone else's call — only they or the founder can approve it." }, { status: 403 });
  }
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `This draft was already ${draft.status}.` }, { status: 409 });
  }

  if (body.action === "reject") {
    await admin.from("wa_task_drafts")
      .update({ status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", draft.id);
    // The messages stay closed — rejecting means "not a task", not "read again".
    // Call drafts have no inbox messages behind them — only WhatsApp ones do.
    if ((draft.source_message_ids || []).length > 0) {
      await admin.from("wa_inbox").update({ is_task: false, status: "done" }).in("id", draft.source_message_ids);
    }
    return NextResponse.json({ success: true, rejected: true });
  }

  if (body.action !== "approve") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // The approver's edits win over whatever the bot proposed.
  const title = (body.title ?? draft.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "A task needs a title" }, { status: 400 });

  const assigneeName = (body.assignee ?? draft.suggested_assignee ?? "").trim() || null;
  let assigneeId: string | null = null;
  if (assigneeName) {
    const { data: member } = await admin.from("team_members").select("profile_id").ilike("name", assigneeName).maybeSingle();
    assigneeId = member?.profile_id || null;
  }

  const type = TASK_TYPES.includes(body.taskType) ? body.taskType : draft.task_type;
  const priority = PRIORITIES.includes(body.priority) ? body.priority : draft.priority;

  const { data: task, error: taskErr } = await admin.from("tasks").insert({
    title: title.slice(0, 200),
    description: (body.description ?? draft.description ?? "") || null,
    client_id: body.clientId ?? draft.client_id ?? null,
    type,
    priority,
    status: "todo",
    deadline: body.deadline
      ? new Date(body.deadline).toISOString()
      : new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    source: draft.source === "call" ? "call" : "whatsapp",
    assignee_name: assigneeName,
    assignee_id: assigneeId,
    metadata: {
      approved_by: user.id,
      wa_draft_id: draft.id,
      // For a call this is the recording's title; for WhatsApp, the group.
      wa_group: draft.group_name,
      ...(draft.call_id ? { call_id: draft.call_id } : {}),
    },
  }).select("id").single();

  if (taskErr) return NextResponse.json({ error: `Could not create the task: ${taskErr.message}` }, { status: 500 });

  await admin.from("wa_task_drafts").update({
    status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString(), task_id: task.id,
  }).eq("id", draft.id);

  if ((draft.source_message_ids || []).length > 0) {
    await admin.from("wa_inbox")
      .update({ task_id: task.id, status: "assigned", assigned_to: assigneeId })
      .in("id", draft.source_message_ids);
  }

  return NextResponse.json({ success: true, taskId: task.id });
}
