import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/content-hub/[id]/send-to-publishing
 * Turns a Content Hub upload into a scheduled post so it shows up in Ad
 * Publishing and gets posted to Meta. Body: { caption?, platform, scheduledFor }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { caption, platform, scheduledFor } = await request.json();
  if (!platform || !["instagram", "facebook"].includes(platform)) {
    return NextResponse.json({ error: "platform must be instagram or facebook" }, { status: 400 });
  }
  if (!scheduledFor) {
    return NextResponse.json({ error: "scheduledFor is required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: upload, error: upErr } = await admin.from("creative_uploads").select("*").eq("id", id).single();
  if (upErr || !upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const { error: insErr } = await admin.from("scheduled_posts").insert({
    client_id: upload.client_id,
    media_url: upload.file_url,
    caption: caption || upload.caption || "",
    platform,
    scheduled_for: scheduledFor,
    status: "scheduled",
    attempts: 0,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await admin.from("creative_uploads").update({ status: "scheduled" }).eq("id", id);

  return NextResponse.json({ success: true });
}
