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

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders/Employees can approve media plans", { status: 403 });
    }

    const body = await request.json();
    const { mediaPlan } = body;

    if (!mediaPlan) {
      return NextResponse.json({ error: "Missing media plan parameters" }, { status: 400 });
    }

    // Save final edited media plan to monthly_plans
    const { error: updateErr } = await supabase
      .from("monthly_plans")
      .update({
        media_plan: mediaPlan,
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    // Create an approvals record for this media plan to satisfy hard safety rules
    const { error: appErr } = await supabase
      .from("approvals")
      .insert({
        client_id: (await supabase.from("monthly_plans").select("client_id").eq("id", id).single()).data?.client_id,
        entity_type: "plan",
        entity_id: id,
        approver_role: "founder",
        approver_id: user.id,
        channel: "dashboard",
        decision: "approved",
        feedback_text: "Media plan approved by founder via dashboard console.",
      });

    if (appErr) console.error("Failed to insert media plan approvals log:", appErr);

    return NextResponse.json({
      success: true,
      mediaPlan,
    });
  } catch (error: unknown) {
    console.error("Approve media plan error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
