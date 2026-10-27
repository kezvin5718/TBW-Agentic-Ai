import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processPendingThumbnails } from "@/lib/video-thumbnail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/thumbnails/process — drain two videos from the thumbnail queue.
 *
 * The cron does this every five minutes, but only where CRON_ENABLED is on.
 * The Content Hub calls this (at most once a minute) while it is showing a
 * video still waiting, so the queue keeps moving with the cron off too. A
 * sweep already under way answers at once with busy: true.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const res = await processPendingThumbnails(2);
    return NextResponse.json({ success: true, ...res });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
