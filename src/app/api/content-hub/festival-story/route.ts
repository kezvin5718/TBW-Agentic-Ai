import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { scheduleFestivalStory } from "@/lib/festival-story";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/content-hub/festival-story
 *
 * Festival stories and what happened to each: waiting on QC, blocked by a
 * failure, or scheduled. This is what the Content Hub section and the
 * dashboard notice both read.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("creative_uploads")
    .select("*, clients(name), festivals(name, scheduled_at), profiles:uploaded_by(name, avatar_url)")
    .not("festival_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  return NextResponse.json({
    success: true,
    uploads: rows,
    // The count the whole team is meant to see — a failed festival creative is
    // work that has stopped, and it stops silently unless somebody says so.
    failed: rows.filter((r) => r.qc_status === "mismatch").length,
    awaitingQc: rows.filter((r) => r.qc_status === "pending").length,
  });
}

/**
 * POST /api/content-hub/festival-story   { uploadId }
 *
 * Schedule a festival creative that has passed QC. Called after the QC sweep,
 * and available by hand for a creative that was re-checked.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { uploadId } = await request.json();
  if (!uploadId) return NextResponse.json({ error: "uploadId required" }, { status: 400 });

  const result = await scheduleFestivalStory(uploadId);
  return NextResponse.json({
    success: !result.blocked && result.failed === 0,
    ...result,
    message: result.blocked
      ? result.notes[0]
      : result.scheduled > 0
        ? `Scheduled as a Story on ${result.scheduled} platform(s). It's in the Library now.`
        : "Nothing was scheduled.",
  });
}
