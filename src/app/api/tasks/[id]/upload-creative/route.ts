import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { mediaUrl, caption } = body;

    if (!mediaUrl || !mediaUrl.trim()) {
      return NextResponse.json({ error: "Media URL is required" }, { status: 400 });
    }

    // 1. Fetch task details
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 2. Resolve creative type based on task type
    let creativeType: "video" | "image" = "image";
    if (task.type === "video") {
      creativeType = "video";
    }

    // Get caption from task drafts or body override
    const draft = task.draft_content as Record<string, unknown> | null;
    const defaultCaption = (draft?.caption as string | undefined) || (draft?.voiceover_script as string | undefined) || "";
    const finalCaption = caption || defaultCaption;

    // 3. Create the creatives row
    const { data: creative, error: creativeErr } = await supabase
      .from("creatives")
      .insert({
        task_id: id,
        type: creativeType,
        caption: finalCaption,
        media_url: mediaUrl,
        qc_status: "pending",
        founder_approval: "pending",
        client_approval: "pending",
      })
      .select()
      .single();

    if (creativeErr) {
      throw creativeErr;
    }

    // 4. Log creative upload to timeline
    await supabase.from("creative_timeline").insert({
      creative_id: creative.id,
      event_type: "creative_uploaded",
      status_from: null,
      status_to: "pending",
      actor_role: "employee",
      notes: `Uploaded media asset: ${mediaUrl}`,
    });

    // 5. Run QC Check
    const { runCreativeQCCheck } = await import("@/lib/qc-utils");
    const qcResult = await runCreativeQCCheck(creative.id);

    // Refresh creative row to get updated status and report
    const { data: updatedCreative } = await supabase
      .from("creatives")
      .select("*")
      .eq("id", creative.id)
      .single();

    return NextResponse.json({
      success: true,
      creative: updatedCreative || creative,
      qcResult,
      taskStatus: qcResult.report?.passed ? "review" : "in_progress",
    });
  } catch (error: unknown) {
    console.error("Upload Creative Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
