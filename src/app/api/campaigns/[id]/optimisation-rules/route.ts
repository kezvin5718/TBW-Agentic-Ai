import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
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

    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("optimisation_rules")
      .eq("id", id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: campErr?.message || "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      rules: campaign.optimisation_rules || {},
    });
  } catch (error: unknown) {
    console.error("Get optimisation rules error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

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
      return new NextResponse("Forbidden: Only Founders/Employees can edit campaign rules", { status: 403 });
    }

    const body = await request.json();
    const { rules } = body;

    if (!rules) {
      return NextResponse.json({ error: "Missing rules parameter" }, { status: 400 });
    }

    const { error: updateErr } = await supabase
      .from("campaigns")
      .update({
        optimisation_rules: rules,
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    // Log this update to ad_ops_audit
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("client_id")
      .eq("id", id)
      .single();

    if (campaign) {
      await supabase.from("ad_ops_audit").insert({
        client_id: campaign.client_id,
        campaign_id: id,
        action_type: "update_optimisation_rules",
        payload: { rules },
        response: { success: true },
        status: "success",
        actor_role: "founder",
      });
    }

    return NextResponse.json({
      success: true,
      rules,
    });
  } catch (error: unknown) {
    console.error("Update optimisation rules error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
