import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestWhatsAppApproval } from "@/lib/integrations/whatsapp";

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
      return new NextResponse("Forbidden: Only Founder or Employees can perform creative reviews", { status: 403 });
    }

    const body = await request.json();
    const { decision, notes } = body; // 'approved' or 'rejected'

    if (!decision || !["approved", "rejected"].includes(decision)) {
      return NextResponse.json({ error: "Invalid review decision" }, { status: 400 });
    }

    // 1. Fetch creative, parent task, monthly plan, client details
    const { data: creative, error: creativeErr } = await supabase
      .from("creatives")
      .select("*, tasks(*, monthly_plans(*, clients(*)))")
      .eq("id", id)
      .single();

    if (creativeErr || !creative) {
      return NextResponse.json({ error: "Creative asset not found" }, { status: 404 });
    }

    const task = creative.tasks;
    const plan = task.monthly_plans;
    const client = plan.clients;

    const taskMeta = (task.metadata || {}) as Record<string, unknown>;

    if (decision === "approved") {
      // A. Update creative status
      const { error: creativeUpdateErr } = await supabase
        .from("creatives")
        .update({
          founder_approval: "approved",
        })
        .eq("id", id);

      if (creativeUpdateErr) throw creativeUpdateErr;

      // B. Log founder review event to timeline
      await supabase.from("creative_timeline").insert({
        creative_id: id,
        event_type: "founder_review",
        status_from: "passed",
        status_to: "founder_approved",
        actor_role: "founder",
        notes: notes || "Approved by founder via Review console.",
      });

      // C. Dispatch to client on WhatsApp
      try {
        await requestWhatsAppApproval({
          clientId: client.id,
          entityType: "creative",
          entityId: id,
          subject: `Creative Approval: ${creative.caption || "Social Post Draft"}`,
          pdfRef: creative.media_url,
        });

        // D. Log dispatch timeline event
        await supabase.from("creative_timeline").insert({
          creative_id: id,
          event_type: "whatsapp_dispatched",
          status_from: "founder_approved",
          status_to: "sent_to_client",
          actor_role: "system",
          notes: `Simulated document and template message dispatched to group number: ${client.whatsapp_group_id || "Unconfigured"}`,
        });
      } catch (whatsappErr) {
        console.error("Failed to trigger WhatsApp client dispatch:", whatsappErr);
      }

    } else {
      // Rejection / Change Request
      // A. Update creative status
      const { error: creativeUpdateErr } = await supabase
        .from("creatives")
        .update({
          founder_approval: "rejected",
        })
        .eq("id", id);

      if (creativeUpdateErr) throw creativeUpdateErr;

      // B. Log founder rejection event to timeline
      await supabase.from("creative_timeline").insert({
        creative_id: id,
        event_type: "founder_review",
        status_from: "passed",
        status_to: "founder_rejected",
        actor_role: "founder",
        notes: notes || "Rejection notes not specified.",
      });

      // C. Re-open parent task to todo so assignee can review changes
      await supabase
        .from("tasks")
        .update({
          status: "todo",
          metadata: {
            ...taskMeta,
            founder_feedback: notes || "",
          },
        })
        .eq("id", task.id);
    }

    return NextResponse.json({
      success: true,
      decision,
      notes,
    });
  } catch (error: unknown) {
    console.error("Founder Creative Review Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
