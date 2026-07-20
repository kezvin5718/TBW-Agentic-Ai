import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { getAgencyBrainDigest } from "@/lib/agency-brain";

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

    // Fetch Monthly Plan
    const { data: plan, error: planErr } = await supabase
      .from("monthly_plans")
      .select("*, clients(*)")
      .eq("id", id)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: planErr?.message || "Monthly plan not found" }, { status: 404 });
    }

    const clientId = plan.client_id;

    // Fetch Brand Brain brief
    const { data: brandBrain } = await supabase
      .from("brand_brain")
      .select("brand_brief")
      .eq("client_id", clientId)
      .single();

    const brandBrief = brandBrain?.brand_brief || "None provided";

    // Fetch shared agency brain digest
    const agencyBrainDigest = await getAgencyBrainDigest();

    // Call Gemini to generate the media plan
    const systemPrompt = "You are the AI Media Planner Assistant for TBW Advertising. Generate structured Meta Ad media plans based on strategies and content pillars.";
    
    const userPrompt = `
    Formulate a structured Meta Marketing Ad Media Plan for the client:
    - Client Name: "${plan.clients?.name || "Client"}"
    - Strategy Summary: "${plan.strategy_summary || ""}"
    - Content Pillars: ${JSON.stringify(plan.content_pillars || [])}
    - Content Calendar Schedule: ${JSON.stringify(plan.content_calendar || [])}
    - Monthly Deliverables Target Count: ${plan.clients?.deliverables_per_month || 10}
    - Total Agreed Monthly Budget: Rs. ${plan.clients?.ad_budget || 50000}
    - Brand Brief & Guidelines:
    ${brandBrief}
    - Agency Shared Insights:
    ${agencyBrainDigest}

    Output a JSON object with this exact structure:
    {
      "objective": "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_ENGAGEMENT" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS",
      "campaign_structure": "Brief description of campaign, ad sets, and ads count split (e.g. 1 Campaign -> 2 Ad Sets -> 4 Ads)",
      "audience_suggestion": "Target demographics, locations, interest profiles, and age range suggestion",
      "daily_budget_split": "Specify split ratio or daily budget breakdown per platform/ad set",
      "expected_cpl_roas_range": "Provide realistic expected ROAS range or Cost-Per-Lead (CPL) range (e.g. ROAS: 2.5 - 3.2)"
    }

    Return ONLY valid JSON. Do not include markdown formatting.
    `;

    let mediaPlan = null;
    try {
      const response = await complete({
        model: MODEL_SMART,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        jsonSchema: {
          type: "object",
        },
      });

      if (response) {
        mediaPlan = JSON.parse(response);
      }
    } catch (llmErr) {
      console.error("AI Media Planner error:", llmErr);
      return NextResponse.json({ error: "Generative model failed to draft media plan." }, { status: 500 });
    }

    if (!mediaPlan) {
      return NextResponse.json({ error: "Failed to compile media plan JSON structure" }, { status: 500 });
    }

    // Save to monthly_plans
    const { error: updateErr } = await supabase
      .from("monthly_plans")
      .update({
        media_plan: mediaPlan,
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      mediaPlan,
    });
  } catch (error: unknown) {
    console.error("Generate media plan error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
