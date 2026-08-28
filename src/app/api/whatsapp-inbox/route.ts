import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET — list inbox items (newest first). ?status=new|assigned|done|dismissed
// Group chatter buries the few messages that matter, so the list can be narrowed to
// direct messages (?dm=1) and/or messages carrying an attachment (?media=1).
// ?before=<ISO received_at> walks further back through the same filtered list —
// or forward through it, when ?sort=oldest turns the list around.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const dmOnly = params.get("dm") === "1";
  const mediaOnly = params.get("media") === "1";
  const before = params.get("before");
  const oldestFirst = params.get("sort") === "oldest";

  let q = supabase
    .from("wa_inbox")
    .select("*, clients(name), profiles:assigned_to(name)")
    .order("received_at", { ascending: oldestFirst })
    .limit(100);
  if (status) q = q.eq("status", status);
  if (dmOnly) q = q.eq("is_dm", true);
  if (mediaOnly) q = q.not("media_url", "is", null);
  // The cursor always means "past the last row you were shown", which is later in time
  // when the list runs oldest-first and earlier when it runs newest-first.
  if (before) q = oldestFirst ? q.gt("received_at", before) : q.lt("received_at", before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, items: data || [] });
}

// PATCH — act on an item: assign / done / dismiss / create_task. Body: { id, action, assignedTo? }
// Or on the whole tray: { action: "clear_all" }, which needs no id.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, action, assignedTo } = await request.json();
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  const admin = createServiceRoleClient();

  // clear_all — sweep the unread tray in one move. Two thousand group messages
  // is not a list anybody reads, and the founder needs a floor to work from.
  //
  // Dismissed, never deleted: the message and whatever it carried to Drive stay
  // exactly where they are and stay queryable — this only stops them being
  // counted as waiting.
  if (action === "clear_all") {
    // Emptying the whole tray is the founder's call alone.
    if (role !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: cleared, error } = await admin
      .from("wa_inbox")
      .update({ status: "dismissed" })
      .eq("status", "new")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, cleared: (cleared || []).length });
  }

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // create_task — convert this WhatsApp message into a Team Task (wa_inbox.task_id links back)
  if (action === "create_task") {
    const { data: item } = await admin.from("wa_inbox").select("*").eq("id", id).single();
    if (!item) return NextResponse.json({ error: "Inbox item not found" }, { status: 404 });
    if (item.task_id) return NextResponse.json({ error: "Task already created for this message" }, { status: 400 });

    const assigneeProfileId = (assignedTo as string) || item.assigned_to || null;
    let assigneeName: string | null = null;
    if (assigneeProfileId) {
      const { data: prof } = await admin.from("profiles").select("name").eq("id", assigneeProfileId).maybeSingle();
      assigneeName = prof?.name || null;
    }

    const title = (item.ai_summary || item.message_text || "WhatsApp task").slice(0, 200);
    const { data: task, error: taskErr } = await admin.from("tasks").insert({
      title,
      description: item.message_text || null,
      client_id: item.client_id || null,
      type: "other",
      priority: item.urgency === "high" ? "high" : "medium",
      status: "todo",
      deadline: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      source: "whatsapp",
      assignee_id: assigneeProfileId,
      assignee_name: assigneeName,
      metadata: { wa_inbox_id: item.id, group_name: item.group_name, sender: item.sender_name },
    }).select("id").single();
    if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });

    const inboxPatch: Record<string, unknown> = { task_id: task.id, status: "assigned" };
    if (assigneeProfileId) inboxPatch.assigned_to = assigneeProfileId;
    const { error: linkErr } = await admin.from("wa_inbox").update(inboxPatch).eq("id", id);
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
    return NextResponse.json({ success: true, taskId: task.id });
  }

  const patch: Record<string, unknown> = {};
  if (action === "assign") {
    patch.status = "assigned";
    patch.assigned_to = assignedTo || user.id; // default: assign to me
  } else if (action === "done") {
    patch.status = "done";
  } else if (action === "dismiss") {
    patch.status = "dismissed";
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { error } = await admin.from("wa_inbox").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
