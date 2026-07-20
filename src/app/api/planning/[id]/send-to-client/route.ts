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
      return new NextResponse("Forbidden", { status: 403 });
    }

    // 1. Fetch plan
    const { data: plan, error: planErr } = await supabase
      .from("monthly_plans")
      .select("*, clients(*)")
      .eq("id", id)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const client = plan.clients;
    const formattedMonth = new Date(plan.month).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });

    // 2. Dispatch via WhatsApp Approval integrations helper
    // Uses the client's guidelines PDF as a mock document reference in storage
    const pdfRef = client.guidelines_url || "guidelines/swad_guidelines.pdf";

    await requestWhatsAppApproval({
      clientId: plan.client_id,
      entityType: "plan",
      entityId: id,
      subject: `${client.name} - ${formattedMonth} Monthly Strategy Plan`,
      pdfRef: pdfRef,
    });

    // 3. Update plan status to sent_to_client
    const { error: updateErr } = await supabase
      .from("monthly_plans")
      .update({
        status: "sent_to_client",
      })
      .eq("id", id);

    if (updateErr) {
      throw updateErr;
    }

    return NextResponse.json({
      success: true,
      status: "sent_to_client",
    });
  } catch (error: unknown) {
    console.error("Send Plan to Client Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
