import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { processCall } from "@/lib/call-notes";

export const dynamic = "force-dynamic";
// Transcribing an hour of audio and reading it back takes a while.
export const maxDuration = 300;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user, isFounder: role === "founder" };
}

/**
 * GET — calls you recorded. The founder sees everyone's, because they carry
 * the whole picture; a manager sees only their own.
 */
export async function GET() {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  let q = admin
    .from("call_recordings")
    .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!guard.isFounder) q = q.eq("uploaded_by", guard.user!.id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    calls: data || [],
    transcriptionReady: !!process.env.OPENAI_API_KEY,
  });
}

/**
 * POST — register an already-uploaded recording and turn it into task drafts.
 * Body: { audioUrl, title, fileName?, sizeMb?, clientId? }
 *
 * The audio goes browser → Supabase directly; only its URL arrives here. An
 * hour of call audio through this process would be the Social Publisher 502
 * all over again.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const body = await request.json();

  if (body.action === "retry" && body.id) {
    const admin = createServiceRoleClient();
    const { data: existing } = await admin.from("call_recordings").select("uploaded_by").eq("id", body.id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    if (!guard.isFounder && existing.uploaded_by !== guard.user!.id) {
      return NextResponse.json({ error: "That call belongs to someone else." }, { status: 403 });
    }
    const result = await processCall(body.id);
    return NextResponse.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 500 });
  }

  if (!body.audioUrl) return NextResponse.json({ error: "Upload the recording first" }, { status: 400 });
  const title = String(body.title || "").trim() || body.fileName || "Untitled call";

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Transcription is not configured — add OPENAI_API_KEY to the server .env and redeploy. The recording was not saved, so nothing is half-done." },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  const { data: call, error } = await admin
    .from("call_recordings")
    .insert({
      uploaded_by: guard.user!.id,
      client_id: body.clientId || null,
      title: title.slice(0, 200),
      audio_url: body.audioUrl,
      file_name: body.fileName || null,
      size_mb: body.sizeMb ?? null,
      status: "uploaded",
    })
    .select("id")
    .single();

  if (error || !call) return NextResponse.json({ error: error?.message || "Could not save the recording" }, { status: 500 });

  const result = await processCall(call.id);
  return NextResponse.json({ success: result.ok, id: call.id, created: result.created, message: result.message });
}

/** DELETE — remove a recording and any drafts still waiting on it. */
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: call } = await admin.from("call_recordings").select("uploaded_by").eq("id", body.id).maybeSingle();
  if (!call) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  if (!guard.isFounder && call.uploaded_by !== guard.user!.id) {
    return NextResponse.json({ error: "That call belongs to someone else." }, { status: 403 });
  }

  // Approved drafts already became tasks and are left alone; only pending ones
  // go, since they have nothing left to be reviewed against.
  await admin.from("wa_task_drafts").delete().eq("call_id", body.id).eq("status", "pending");
  const { error } = await admin.from("call_recordings").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
