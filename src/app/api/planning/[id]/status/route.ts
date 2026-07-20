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
      return new NextResponse("Forbidden: Only Founder or Employees can perform approvals", { status: 403 });
    }

    const body = await request.json();
    const { status, notes } = body;

    if (!status || !["internal_review", "rejected", "approved"].includes(status)) {
      return NextResponse.json({ error: "Invalid status code" }, { status: 400 });
    }

    // 1. Fetch plan to check details
    const { data: plan, error: planErr } = await supabase
      .from("monthly_plans")
      .select("*")
      .eq("id", id)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // 2. Update Plan Status
    const { error: updateErr } = await supabase
      .from("monthly_plans")
      .update({
        status: status,
      })
      .eq("id", id);

    if (updateErr) {
      throw updateErr;
    }

    if (status === "approved") {
      const { generateTasksForPlan } = await import("@/lib/tasks-utils");
      await generateTasksForPlan(id);
    }

    // 3. Log into approvals table for audit trail
    const { error: approvalErr } = await supabase
      .from("approvals")
      .insert({
        client_id: plan.client_id,
        entity_type: "plan",
        entity_id: id,
        approver_role: "founder",
        approver_id: user.id,
        channel: "dashboard",
        decision: (status === "internal_review" || status === "approved") ? "approved" : "rejected",
        feedback_text: notes || "",
      });

    if (approvalErr) {
      console.error("Failed to log approval audit entry:", approvalErr);
    }

    return NextResponse.json({
      success: true,
      status,
      notes,
    });
  } catch (error: unknown) {
    console.error("Plan Status Update Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
