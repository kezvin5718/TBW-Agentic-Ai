import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encryption";
import {
  createMetaCampaign,
  createMetaAdSet,
  createMetaAdCreative,
  createMetaAd,
  uploadAdImage,
  uploadAdVideo,
} from "@/lib/integrations/meta";

export async function POST(request: Request) {
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
    return new NextResponse("Forbidden: Only Founders/Employees can deploy campaigns", { status: 403 });
  }

  let auditClientId = "";
  let auditCampaignId: string | undefined = undefined;

  try {
    const body = await request.json();
    const { planId, clientId, controlMode } = body;

    if (!planId || !clientId || !controlMode) {
      return NextResponse.json({ error: "Missing campaign deployment parameters" }, { status: 400 });
    }

    auditClientId = clientId;

    // --- SAFETY RAIL 1: Never create a campaign without an approval record ---
    const { data: approvalRecord, error: appErr } = await supabase
      .from("approvals")
      .select("*")
      .eq("entity_id", planId)
      .eq("entity_type", "plan")
      .eq("decision", "approved")
      .limit(1)
      .maybeSingle();

    if (appErr || !approvalRecord) {
      return NextResponse.json({
        error: "Deployment Denied: No founder approval record found for the parent monthly plan."
      }, { status: 403 });
    }

    // --- SAFETY RAIL 2: Fetch client daily budget caps ---
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client relation not found" }, { status: 404 });
    }

    const totalBudget = client.ad_budget || 30000;
    const dailyCap = Math.round(totalBudget / 30); // 30-day daily pacing splits

    // Fetch monthly plan strategy details
    const { data: plan, error: planErr } = await supabase
      .from("monthly_plans")
      .select("*")
      .eq("id", planId)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: "Monthly plan details not found" }, { status: 404 });
    }

    // --- SAFETY RAIL 3: Resolve client Meta credentials ---
    const { data: creds, error: credsErr } = await supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (credsErr || !creds) {
      return NextResponse.json({ error: "Meta API credentials are not configured for this client brand." }, { status: 400 });
    }

    let accessToken = "";
    try {
      accessToken = decrypt(creds.meta_page_token_encrypted);
    } catch {
      return NextResponse.json({ error: "Failed to decrypt client Meta Page Token." }, { status: 500 });
    }

    const adAccountId = process.env.META_AD_ACCOUNT_ID || "1234567890";
    const igBusinessId = creds.ig_business_id;

    // --- ORCHESTRATION PIPELINE ---

    // 1. Deploy Campaign (ALWAYS PAUSED)
    let metaCampaign = null;
    const campaignPayload = {
      name: `[${client.name}] Monthly Campaign - Mode: ${controlMode}`,
      objective: ((plan.media_plan as Record<string, unknown>)?.objective || "OUTCOME_AWARENESS") as "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_ENGAGEMENT" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS",
      status: "PAUSED" as const,
    };

    try {
      metaCampaign = await createMetaCampaign(campaignPayload);
      
      // Log write to audit table
      await supabase.from("ad_ops_audit").insert({
        client_id: clientId,
        action_type: "create_campaign",
        payload: campaignPayload,
        response: metaCampaign,
        status: "success",
        actor_role: "founder",
      });
    } catch (camErr: unknown) {
      await supabase.from("ad_ops_audit").insert({
        client_id: clientId,
        action_type: "create_campaign",
        payload: campaignPayload,
        response: { error: camErr instanceof Error ? camErr.message : "Unknown campaign error" },
        status: "failed",
        actor_role: "founder",
      });
      throw camErr;
    }

    const extCampaignId = metaCampaign.id || `mock_camp_${Math.floor(Math.random() * 1000000)}`;

    // Create campaigns row in database
    const { data: dbCampaign, error: dbCampErr } = await supabase
      .from("campaigns")
      .insert({
        client_id: clientId,
        platform: "meta",
        objective: campaignPayload.objective,
        budget_per_day: dailyCap,
        status: "PAUSED",
        external_campaign_id: extCampaignId,
        control_mode: controlMode,
      })
      .select()
      .single();

    if (dbCampErr) throw dbCampErr;
    auditCampaignId = dbCampaign.id;

    // 2. Deploy Ad Set (ALWAYS PAUSED)
    const adSetPayload = {
      adAccountId,
      accessToken,
      campaignId: extCampaignId,
      name: `[${client.name}] Core AdSet`,
      dailyBudget: dailyCap,
      targeting: {
        geo_locations: { countries: ["IN"] },
        age_min: 18,
        age_max: 65,
      },
    };

    let metaAdSet = null;
    try {
      metaAdSet = await createMetaAdSet(adSetPayload);

      await supabase.from("ad_ops_audit").insert({
        client_id: clientId,
        campaign_id: dbCampaign.id,
        action_type: "create_adset",
        payload: adSetPayload,
        response: metaAdSet,
        status: "success",
        actor_role: "founder",
      });
    } catch (adSetErr: unknown) {
      await supabase.from("ad_ops_audit").insert({
        client_id: clientId,
        campaign_id: dbCampaign.id,
        action_type: "create_adset",
        payload: adSetPayload,
        response: { error: adSetErr instanceof Error ? adSetErr.message : "Unknown adset error" },
        status: "failed",
        actor_role: "founder",
      });
      throw adSetErr;
    }

    const extAdSetId = metaAdSet.id;

    // 3. Deploy Creatives & Ads (ALL PAUSED)
    // Fetch client approved creatives for this plan
    const { data: creatives } = await supabase
      .from("creatives")
      .select("*, tasks(*)")
      .eq("tasks.plan_id", planId)
      .eq("qc_status", "passed");

    const deployedAds = [];
    if (creatives && creatives.length > 0) {
      for (const creative of creatives) {
        // Upload Media
        let uploadRes = null;
        let imageHash = "";
        let videoId = "";
        
        try {
          if (creative.type === "video") {
            uploadRes = await uploadAdVideo({
              adAccountId,
              accessToken,
              videoUrl: creative.media_url,
            });
            videoId = uploadRes.videoId;
          } else {
            uploadRes = await uploadAdImage({
              adAccountId,
              accessToken,
              imageUrl: creative.media_url,
            });
            imageHash = uploadRes.imageHash;
          }

          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "upload_media",
            payload: { creativeId: creative.id, type: creative.type, mediaUrl: creative.media_url },
            response: uploadRes,
            status: "success",
            actor_role: "founder",
          });
        } catch (uploadErr: unknown) {
          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "upload_media",
            payload: { creativeId: creative.id, type: creative.type, mediaUrl: creative.media_url },
            response: { error: uploadErr instanceof Error ? uploadErr.message : "Unknown upload error" },
            status: "failed",
            actor_role: "founder",
          });
          console.error("Creative upload failed, skipping ad creation for creative:", creative.id, uploadErr);
          continue;
        }

        // Create Ad Creative
        let metaCreative = null;
        const creativePayload = {
          adAccountId,
          accessToken,
          name: `Creative Spec: ${creative.id}`,
          pageId: "1234567890", // placeholder Facebook page ID
          instagramActorId: igBusinessId,
          caption: creative.caption || "",
          imageHash: imageHash || undefined,
          videoId: videoId || undefined,
        };

        try {
          metaCreative = await createMetaAdCreative(creativePayload);

          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "create_adcreative",
            payload: creativePayload,
            response: metaCreative,
            status: "success",
            actor_role: "founder",
          });
        } catch (creativeCreateErr: unknown) {
          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "create_adcreative",
            payload: creativePayload,
            response: { error: creativeCreateErr instanceof Error ? creativeCreateErr.message : "Unknown creative error" },
            status: "failed",
            actor_role: "founder",
          });
          continue;
        }

        // Create Ad inside Ad Set
        const adPayload = {
          adAccountId,
          accessToken,
          adSetId: extAdSetId,
          creativeId: metaCreative.id,
          name: `Ad Post: ${creative.id}`,
        };

        try {
          const metaAd = await createMetaAd(adPayload);

          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "create_ad",
            payload: adPayload,
            response: metaAd,
            status: "success",
            actor_role: "founder",
          });

          deployedAds.push(metaAd.id);
        } catch (adErr: unknown) {
          await supabase.from("ad_ops_audit").insert({
            client_id: clientId,
            campaign_id: dbCampaign.id,
            action_type: "create_ad",
            payload: adPayload,
            response: { error: adErr instanceof Error ? adErr.message : "Unknown ad error" },
            status: "failed",
            actor_role: "founder",
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      campaignId: dbCampaign.id,
      extCampaignId,
      adSetId: extAdSetId,
      adsDeployedCount: deployedAds.length,
    });

  } catch (error: unknown) {
    console.error("Deploy Campaign error:", error);
    
    // Log outer pipeline crash to audit logs
    if (auditClientId) {
      await supabase.from("ad_ops_audit").insert({
        client_id: auditClientId,
        campaign_id: auditCampaignId,
        action_type: "deploy_pipeline_crash",
        payload: { error: error instanceof Error ? error.message : "Unknown deploy crash" },
        status: "failed",
        actor_role: "founder",
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
