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
    const { comment, sender } = body;

    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: "Comment text is required" }, { status: 400 });
    }

    // 1. Fetch existing brand brain to get current feedback log
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("feedback_log")
      .eq("client_id", id)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain profile not found" }, { status: 404 });
    }

    const currentLog = Array.isArray(brandBrain.feedback_log) ? brandBrain.feedback_log : [];
    
    // 2. Append new entry
    const newEntry = {
      date: new Date().toISOString(),
      sender: sender || "founder",
      comment: comment.trim(),
    };

    const updatedLog = [newEntry, ...currentLog]; // Prepend so latest shows first

    // 3. Update public.brand_brain
    const { data: updatedBrain, error: updateErr } = await supabase
      .from("brand_brain")
      .update({
        feedback_log: updatedLog,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", id)
      .select("feedback_log")
      .single();

    if (updateErr) {
      console.error("Failed to append feedback comment:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      feedbackLog: updatedBrain.feedback_log,
    });
  } catch (error: unknown) {
    console.error("Feedback append request error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
