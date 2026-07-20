import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { getAgencyBrainDigest } from "@/lib/agency-brain";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { clientId, month, rejectNotes } = body;

    if (!clientId || !month) {
      return NextResponse.json({ error: "clientId and month are required" }, { status: 400 });
    }

    // 1. Fetch client
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch Brand Brain
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", clientId)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain not found" }, { status: 404 });
    }

    // Fetch shared agency brain digest
    const agencyBrainDigest = await getAgencyBrainDigest();

    // 3. Construct LLM query
    const systemPrompt = "You are the Marketing Director Bot for TBW Advertising. You analyze a client's brand guidelines, historical results, and feedback to draft the core monthly strategy summary and pillars. You output structured JSON.";

    const userMessage = `Create a monthly marketing strategy for ${client.name} for the month of ${month}.
    
Brand Brief:
${brandBrain.brand_brief || "None provided"}

Agency Shared Insights:
${agencyBrainDigest}

Feedback History Log:
${JSON.stringify(brandBrain.feedback_log || [])}

Recent Results Log (Campaign learnings):
${JSON.stringify(brandBrain.results_log || [])}

${rejectNotes ? `CRITICAL FEEDBACK FROM FOUNDER (Incorporate these changes): \n${rejectNotes}\n` : ""}

Generate a JSON object containing:
- goals: A concise summary of 2-3 marketing goals for this month (e.g. build brand affinity, showcase ready-to-eat convenience).
- focus: The central creative focus area for this month.
- contentPillars: An array of 3 to 5 content pillars (e.g. ["Traditional Spice Heritage", "Quick Recipes", "NRI Nostalgia"]).`;

    const jsonSchema = {
      type: "object",
      properties: {
        goals: { type: "string" },
        focus: { type: "string" },
        contentPillars: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["goals", "focus", "contentPillars"],
    };

    const aiResponse = await complete({
      model: MODEL_SMART,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      jsonSchema,
    });

    if (!aiResponse) {
      throw new Error("Generative engine returned an empty response.");
    }

    const parsed = JSON.parse(aiResponse);

    return NextResponse.json({
      success: true,
      strategySummary: `Goals:\n${parsed.goals}\n\nCentral Focus:\n${parsed.focus}`,
      contentPillars: parsed.contentPillars,
    });
  } catch (error: unknown) {
    console.error("Strategy Generation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
