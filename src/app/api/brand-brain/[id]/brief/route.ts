import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";

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

    // 1. Fetch client details
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch linked brand_brain
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", id)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain profile not found" }, { status: 404 });
    }

    // 3. Construct System Prompt & User Message for brief synthesis
    const systemPrompt = "You are an expert brand strategy consultant. You synthesize client data into high-fidelity, actionable brand briefs under 800 words. You output raw, clean Markdown without surrounding code fences.";

    const userMessage = `You are the Brand Brief Synthesizer for TBW Advertising. 
Generate a comprehensive, high-fidelity 1-page Brand Brief for:

Brand Name: ${client.name}
Products/Services to Promote: ${JSON.stringify(client.products)}
Target Audience: ${client.target_audience}

Styling Guidelines:
- Color Palette Hexes: ${JSON.stringify(brandBrain.colors || [])}
- Typeface Fonts: ${JSON.stringify(brandBrain.fonts || [])}
- Caption Tone Guide: ${brandBrain.caption_tone || "Not set"}
- Design Preferences: ${JSON.stringify(brandBrain.design_preferences || {})}
- Historical Feedback comments: ${JSON.stringify(brandBrain.feedback_log || [])}
- Past Campaign Learnings: ${JSON.stringify(brandBrain.results_log || [])}

Generate a 1-page brief containing:
1. **Brand Core Essence**: What this brand is and what makes it unique.
2. **Audience Hook Points**: Demographics and what triggers their interest.
3. **Copywriting Rules**: Tone directives, caption guidelines, specific do's and don'ts.
4. **Visual Direction**: Color usage, typography feel, layout style.
5. **Creative Constraints**: Content hooks or rules that must always be followed.

Keep the content highly actionable, under 800 words, and formatted in clean, professional markdown. Do NOT wrap in \`\`\`markdown code block fences. Output the brief directly.`;

    // 4. Run LLM call
    const brief = await complete({
      model: MODEL_SMART,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    if (!brief) {
      throw new Error("Generative engine returned an empty brief.");
    }

    // 5. Save Brief to Brand Brain
    const { data: updatedBrain, error: updateErr } = await supabase
      .from("brand_brain")
      .update({
        brand_brief: brief,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", id)
      .select()
      .single();

    if (updateErr) {
      console.error("Failed to update brand brief in database:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      brandBrief: brief,
      brandBrain: updatedBrain,
    });
  } catch (error: unknown) {
    console.error("Brand Brief Generation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
