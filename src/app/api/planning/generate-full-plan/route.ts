import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_CHATGPT } from "@/lib/llm-config";
import { getAgencyBrainDigest } from "@/lib/agency-brain";

export const dynamic = "force-dynamic";

interface CalendarSlot {
  date: string;
  platform: string;
  format: string;
  concept: string;
  hook: string;
  CTA: string;
}
interface Allocation {
  objective: string;
  percentage: number;
  amount: number;
  rationale: string;
}
interface FullPlan {
  strategySummary: string;
  contentPillars: string[];
  contentCalendar: CalendarSlot[];
  budgetSummary: { allocations: Allocation[] };
}

/**
 * POST /api/planning/generate-full-plan
 * One-shot: generates an ENTIRE monthly plan (strategy + pillars + calendar + budget)
 * in a single ChatGPT (GPT-4o) call via OpenRouter, returned as structured JSON.
 * Does NOT persist — the UI loads it into the editable wizard for review, then saves
 * through the existing /api/planning/save-plan route.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (user.user_metadata?.role as string) || "client";
    if (role !== "founder" && role !== "employee") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { clientId, month } = await request.json();
    if (!clientId || !month) {
      return NextResponse.json({ error: "clientId and month are required" }, { status: 400 });
    }

    const { data: client, error: clientErr } = await supabase.from("clients").select("*").eq("id", clientId).single();
    if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const { data: brandBrain } = await supabase.from("brand_brain").select("brand_brief").eq("client_id", clientId).maybeSingle();
    const agencyDigest = await getAgencyBrainDigest();

    const deliverables = Number(client.deliverables_per_month) || 8;
    const budget = Number(client.ad_budget) || 50000;
    const monthLabel = new Date(month).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    const system =
      "You are the Head of Strategy at TBW Advertising, an AI-video ad agency in India. You produce a complete, ready-to-execute monthly marketing plan as a SINGLE JSON object. Output ONLY the JSON object — no markdown code fences, no commentary.";

    const userPrompt = `Create a complete monthly marketing plan for the client "${client.name}" for ${monthLabel}.

Client context:
- Target audience: ${client.target_audience || "Not specified"}
- Products/services: ${JSON.stringify(client.products || [])}
- Deliverables target this month: ${deliverables}
- Total monthly ad budget: INR ${budget}

Brand brief:
${brandBrain?.brand_brief || "None provided"}

${agencyDigest}

Return a JSON object with EXACTLY this shape:
{
  "strategySummary": "3-5 sentences describing the month's goals and central creative focus.",
  "contentPillars": ["pillar 1", "pillar 2", "pillar 3"],   // 3 to 5 pillars
  "contentCalendar": [
    { "date": "YYYY-MM-DD", "platform": "instagram" | "facebook" | "youtube", "format": "static" | "reel" | "carousel", "concept": "specific concept", "hook": "first-3-seconds hook", "CTA": "call to action" }
  ],   // EXACTLY ${deliverables} items, dates spread across ${monthLabel}, concrete (never placeholders), no repeated hooks/concepts
  "budgetSummary": {
    "allocations": [
      { "objective": "e.g. Conversions / Awareness", "percentage": 60, "amount": 30000, "rationale": "2 sentences" }
    ]
  }   // 2 to 4 allocations, percentages sum to 100, amounts (INR) sum to ${budget}
}

Return ONLY valid JSON.`;

    const raw = await complete({
      system,
      messages: [{ role: "user", content: userPrompt }],
      model: MODEL_CHATGPT,
      jsonSchema: { type: "object" },
      maxTokens: 3000,
    });

    const fallback: FullPlan = {
      strategySummary: `Monthly plan for ${client.name} — ${monthLabel}.`,
      contentPillars: ["Product Spotlight", "Customer Stories", "Behind the Scenes"],
      contentCalendar: [],
      budgetSummary: { allocations: [] },
    };
    const plan = safeJsonParse<FullPlan>(raw, fallback);

    // Light normalization / guards
    plan.contentPillars = Array.isArray(plan.contentPillars) ? plan.contentPillars.slice(0, 6) : fallback.contentPillars;
    plan.contentCalendar = Array.isArray(plan.contentCalendar)
      ? plan.contentCalendar
          .filter((s) => s && s.date)
          .sort((a, b) => (a.date < b.date ? -1 : 1))
      : [];
    if (!plan.budgetSummary || !Array.isArray(plan.budgetSummary.allocations)) {
      plan.budgetSummary = { allocations: [] };
    }

    return NextResponse.json({ success: true, plan });
  } catch (err: unknown) {
    console.error("generate-full-plan error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to generate plan" }, { status: 500 });
  }
}
