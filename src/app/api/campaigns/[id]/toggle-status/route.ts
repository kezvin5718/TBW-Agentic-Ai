import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encryption";

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
      return new NextResponse("Forbidden: Only Founders/Employees can toggle campaigns", { status: 403 });
    }

    const body = await request.json();
    const { status } = body; // 'ACTIVE' or 'PAUSED'

    if (!status || !["ACTIVE", "PAUSED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status parameter" }, { status: 400 });
    }

    // 1. Fetch Campaign
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // --- SAFETY RAIL: Control Modes constraint verification ---
    if (campaign.control_mode === "draft_only" && status === "ACTIVE") {
      return NextResponse.json({
        error: "Activation Denied: Deployed campaign is set to 'draft_only' mode. It is locked in a paused state."
      }, { status: 403 });
    }

    // 2. Fetch and decrypt Meta credentials
    const { data: creds, error: credsErr } = await supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", campaign.client_id)
      .maybeSingle();

    if (credsErr || !creds) {
      return NextResponse.json({ error: "Client Meta credentials are not configured" }, { status: 400 });
    }

    let accessToken = "";
    try {
      accessToken = decrypt(creds.meta_page_token_encrypted);
    } catch {
      return NextResponse.json({ error: "Failed to decrypt client Meta access token credentials" }, { status: 500 });
    }

    // 3. Update Meta Campaign Status (real/mock)
    const extId = campaign.external_campaign_id;
    let metaRes = null;

    if (!accessToken || accessToken.startsWith("mock_") || accessToken === "placeholder") {
      metaRes = { success: true, id: extId, status };
    } else {
      // Hit Meta Graph API to update status
      const url = new URL(`https://graph.facebook.com/v21.0/${extId}`);
      url.searchParams.append("access_token", accessToken);
      url.searchParams.append("status", status);

      const res = await fetch(url.toString(), { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        // Log failure to ad_ops_audit
        await supabase.from("ad_ops_audit").insert({
          client_id: campaign.client_id,
          campaign_id: id,
          action_type: "toggle_status",
          payload: { status },
          response: { error: data.error?.message || res.statusText },
          status: "failed",
          actor_role: "founder",
        });
        throw new Error(`Meta status update failed: ${data.error?.message || res.statusText}`);
      }
      metaRes = data;
    }

    // 4. Log write to audit table
    await supabase.from("ad_ops_audit").insert({
      client_id: campaign.client_id,
      campaign_id: id,
      action_type: "toggle_status",
      payload: { status },
      response: metaRes,
      status: "success",
      actor_role: "founder",
    });

    // 5. Update campaigns row in database
    const { error: updateErr } = await supabase
      .from("campaigns")
      .update({
        status: status,
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: unknown) {
    console.error("Toggle campaign status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
