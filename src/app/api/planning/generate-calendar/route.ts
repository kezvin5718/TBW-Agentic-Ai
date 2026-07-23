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
    const { clientId, month, strategySummary, contentPillars, qtyStatic, qtyReel, qtyCarousel } = body;

    if (!clientId || !month || !strategySummary) {
      return NextResponse.json({ error: "clientId, month, and strategySummary are required" }, { status: 400 });
    }

    // 1. Fetch client details to get monthly quota
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("name, deliverables_per_month")
      .eq("id", clientId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch Brand Brain brief
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("brand_brief")
      .eq("client_id", clientId)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain not found" }, { status: 404 });
    }

    // Calculate total slots requested or fallback to quota
    const hasQuantities = qtyStatic !== undefined && qtyReel !== undefined && qtyCarousel !== undefined;
    const totalSlots = hasQuantities ? (Number(qtyStatic) + Number(qtyReel) + Number(qtyCarousel)) : (client.deliverables_per_month || 4);

    let formatBreakdownInstruction = "";
    if (hasQuantities) {
      formatBreakdownInstruction = `Of these ${totalSlots} slots, exactly ${qtyStatic} must have format="static", exactly ${qtyReel} must have format="reel", and exactly ${qtyCarousel} must have format="carousel".`;
    }

    // Fetch shared agency brain digest
    const agencyBrainDigest = await getAgencyBrainDigest();

    // 3. Prompt LLM to map out the calendar
    const systemPrompt = "You are the Production Planner Bot for TBW Advertising. You generate chronological social media content calendar slots in JSON format.";

    const userMessage = `Brand: ${client.name}
Month Target: ${month}
Plan Quota: ${totalSlots} deliverables (spread dates evenly across this month)

Brand Strategy Summary:
${strategySummary}

Content Pillars:
${JSON.stringify(contentPillars || [])}

Brand Brief & Guidelines:
${brandBrain.brand_brief || "None"}

Agency Shared Insights:
${agencyBrainDigest}

Generate exactly ${totalSlots} content calendar slots. ${formatBreakdownInstruction}
For each slot, provide:
- date: A string representing the post date spread across the month (format YYYY-MM-DD).
- platform: "instagram" | "facebook" | "youtube".
- format: "static" | "reel" | "carousel".
- concept: The specific creative theme/concept (e.g. Swad Mango Pickles Nostalgia).
- hook: The opening copy hook or visual sequence description (first 3 seconds).
- CTA: The specific call to action (e.g. Shop pickles on Amazon, link in bio).`;

    const jsonSchema = {
      type: "object",
      properties: {
        calendar: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              platform: { type: "string" },
              format: { type: "string" },
              concept: { type: "string" },
              hook: { type: "string" },
              CTA: { type: "string" },
            },
            required: ["date", "platform", "format", "concept", "hook", "CTA"],
          },
        },
      },
      required: ["calendar"],
    };

    const aiResponse = await complete({
      model: MODEL_SMART,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      jsonSchema,
    });

    if (!aiResponse) {
      throw new Error("Generative engine returned an empty calendar.");
    }

    const defaultCalendarItems = Array.from({ length: totalSlots }, (_, i) => {
      const day = String(Math.min(28, (i + 1) * 5)).padStart(2, "0");
      return {
        date: `${month.substring(0, 7)}-${day}`,
        platform: "instagram" as const,
        format: "reel" as "static" | "reel" | "carousel",
        concept: "Creative product showcase",
        hook: "First 3 seconds hook sequence",
        CTA: "Check link in bio"
      };
    });
    const parsed = safeJsonParse(aiResponse, {
      calendar: defaultCalendarItems
    });

    const slots = parsed.calendar || [];
    // Pad or truncate to ensure correct length
    while (slots.length < totalSlots) {
      const day = String(Math.min(28, (slots.length + 1) * 3)).padStart(2, "0");
      slots.push({
        date: `${month.substring(0, 7)}-${day}`,
        platform: "instagram",
        format: "reel",
        concept: "Creative product showcase",
        hook: "First 3 seconds hook sequence",
        CTA: "Check link in bio"
      });
    }
    if (slots.length > totalSlots) {
      slots.splice(totalSlots);
    }

    // Deterministically assign the requested quantities to guarantee alignment
    if (hasQuantities) {
      let staticAssigned = 0;
      let reelAssigned = 0;
      const staticTarget = Number(qtyStatic);
      const reelTarget = Number(qtyReel);
      
      for (let i = 0; i < slots.length; i++) {
        if (staticAssigned < staticTarget) {
          slots[i].format = "static";
          staticAssigned++;
        } else if (reelAssigned < reelTarget) {
          slots[i].format = "reel";
          reelAssigned++;
        } else {
          slots[i].format = "carousel";
        }
      }
    }

    // Sort calendar by date ascending
    const sortedCalendar = slots.sort(
      (a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return NextResponse.json({
      success: true,
      calendar: sortedCalendar,
    });
  } catch (error: unknown) {
    console.error("Calendar Generation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
