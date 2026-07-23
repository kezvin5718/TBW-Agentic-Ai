import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
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
    const { clientId, month, adBudget, strategySummary, contentCalendar } = body;

    if (!clientId || !month || !adBudget || !strategySummary) {
      return NextResponse.json({ error: "clientId, month, adBudget, and strategySummary are required" }, { status: 400 });
    }

    // 1. Fetch client details
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch Brand Brain brief
    const { data: brandBrain } = await supabase
      .from("brand_brain")
      .select("brand_brief")
      .eq("client_id", clientId)
      .single();

    const brandBrief = brandBrain?.brand_brief || "None provided";

    // 3. Fetch shared agency brain digest
    const agencyBrainDigest = await getAgencyBrainDigest();

    // 4. Prompt LLM to split budget
    const systemPrompt = "You are the Media Planner Bot for TBW Advertising. You generate structured monthly ad budget allocation suggestions across platform objectives.";

    const userMessage = `Client Name: ${client.name}
Month: ${month}
Total Ad Budget: INR ${adBudget}

Strategy Summary:
${strategySummary}

Brand Brief & Guidelines:
${brandBrief}

Agency Shared Insights:
${agencyBrainDigest}

Content Calendar Slots:
${JSON.stringify(contentCalendar || [])}

Generate a JSON object allocating the total budget of ${adBudget} across 2 to 4 advertising objectives (e.g., Conversion, Lead Generation, Brand Awareness).
The sum of percentages must equal 100%. The sum of amounts must equal the total budget of ${adBudget}.
For each objective, provide:
- objective: The platform objective name (e.g., Conversion/Sales, Lead Generation, Engagement, Awareness).
- percentage: The percentage of the budget allocated (e.g. 50).
- amount: The calculated amount in INR (e.g. 75000).
- rationale: A 2-sentence marketing rationale explaining why this allocation makes sense.`;

    const jsonSchema = {
      type: "object",
      properties: {
        allocations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objective: { type: "string" },
              percentage: { type: "number" },
              amount: { type: "number" },
              rationale: { type: "string" },
            },
            required: ["objective", "percentage", "amount", "rationale"],
          },
        },
      },
      required: ["allocations"],
    };

    const aiResponse = await complete({
      model: MODEL_SMART,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      jsonSchema,
    });

    if (!aiResponse) {
      throw new Error("Generative engine returned an empty budget allocation.");
    }

    const parsed = safeJsonParse(aiResponse, {
      allocations: [
        { objective: "Conversion/Sales", percentage: 60, amount: Math.round(Number(adBudget) * 0.6), rationale: "Focus on driving conversion and direct purchases." },
        { objective: "Awareness & Engagement", percentage: 40, amount: Math.round(Number(adBudget) * 0.4), rationale: "Establish visual presence and community engagement." }
      ]
    });

    return NextResponse.json({
      success: true,
      allocations: parsed.allocations,
    });
  } catch (error: unknown) {
    console.error("Budget Allocation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
