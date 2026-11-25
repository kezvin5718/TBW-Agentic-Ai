import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { kickCaptions } from "@/lib/caption-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The live end of the automatic captions.
 *
 *   GET   ?ids=a,b,c          — where each creative's caption stands, for the
 *                               screens to show "Analysing… / Generating… /
 *                               Ready / Failed" and drop a finished caption in.
 *   PATCH { id, caption }     — a person's own caption. Saved as theirs
 *                               (caption_source 'manual'); the background job
 *                               never overwrites it.
 *   POST  { id, action: "retry" } — put a failed caption back in the queue,
 *                               with its attempts counted from nothing.
 */

async function staff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  return { user, ok: !!user && ["founder", "employee"].includes(role) };
}

const STATUS_COLS = "id, caption, caption_status, caption_source, caption_error, caption_attempts";
const IN_QUEUE = ["pending", "analysing", "writing"];

export async function GET(request: NextRequest) {
  const { ok } = await staff();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ids = (new URL(request.url).searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ success: true, captions: [] });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from("creative_uploads").select(STATUS_COLS).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A screen waiting on a queued caption also nudges the queue, so it drains
  // even on a server whose cron is off.
  if ((data || []).some((r) => r.caption_status === "pending")) kickCaptions();
  return NextResponse.json({ success: true, captions: data || [] });
}

export async function PATCH(request: NextRequest) {
  const { ok } = await staff();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || typeof body.caption !== "string") return NextResponse.json({ error: "id and caption are required" }, { status: 400 });
  const caption = body.caption.slice(0, 5000);

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("creative_uploads").select("caption, caption_source").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "That creative no longer exists." }, { status: 404 });
  // Leaving a box without changing it is not an edit — it must not turn an AI
  // caption into a "hand-written" one that no rewrite will touch.
  if ((row.caption || "") === caption) return NextResponse.json({ success: true, unchanged: true, caption_source: row.caption_source });

  const { error } = await admin
    .from("creative_uploads")
    .update({
      caption,
      caption_source: "manual",
      caption_status: "done",
      caption_error: null,
      caption_updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await admin.from("caption_job_log").insert({ upload_id: id, stage: "manual_edit", message: "saved by a person" }); } catch { /* log is best-effort */ }
  return NextResponse.json({ success: true, caption_source: "manual" });
}

export async function POST(request: NextRequest) {
  const { ok } = await staff();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || body.action !== "retry") return NextResponse.json({ error: "id and action: retry are required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: moved } = await admin
    .from("creative_uploads")
    .update({ caption_status: "pending", caption_attempts: 0, caption_error: null })
    .eq("id", id)
    .in("caption_status", ["failed", "no_contact", "none"])
    .select("id");
  if (!moved || moved.length === 0) {
    const { data: now } = await admin.from("creative_uploads").select("caption_status").eq("id", id).maybeSingle();
    const status = String(now?.caption_status || "");
    return NextResponse.json({
      success: IN_QUEUE.includes(status),
      status,
      error: IN_QUEUE.includes(status) ? undefined : "Nothing to retry — this caption is already written.",
    });
  }
  kickCaptions(200);
  return NextResponse.json({ success: true, status: "pending" });
}
