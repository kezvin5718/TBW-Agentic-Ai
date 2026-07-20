import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executePublishForCreative } from "@/lib/publish-executor";

export async function GET() {
  try {
    const supabase = await createClient();
    const nowStr = new Date().toISOString();

    // 1. Fetch creatives where:
    // - client_approval = 'approved'
    // - published_at IS NULL
    // - linked task deadline <= now
    const { data: dueCreatives, error: fetchErr } = await supabase
      .from("creatives")
      .select("*, tasks(*)")
      .eq("client_approval", "approved")
      .is("published_at", null)
      .lte("tasks.deadline", nowStr);

    if (fetchErr) {
      console.error("Failed to query due creatives for cron publish:", fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    // Filter out creatives where task joined is null (due to inner join behavior on LTE)
    const validCreatives = (dueCreatives || []).filter(c => c.tasks !== null);

    console.log(`Cron publishing: Found ${validCreatives.length} due creatives at ${nowStr}`);

    const results = [];
    for (const creative of validCreatives) {
      try {
        const res = await executePublishForCreative(creative.id);
        results.push({
          creativeId: creative.id,
          success: res.success,
          platformPostId: res.platformPostId,
          error: res.error,
        });
      } catch (err: unknown) {
        console.error(`Cron publishing failed for creative ${creative.id}:`, err);
        results.push({
          creativeId: creative.id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error inside cron loop",
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: validCreatives.length,
      results,
    });
  } catch (error: unknown) {
    console.error("Publishing Cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
