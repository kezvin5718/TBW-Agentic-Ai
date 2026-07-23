import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";
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

    // 1. Fetch task and linked monthly plan details
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("*, monthly_plans(*, clients(*))")
      .eq("id", id)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const plan = task.monthly_plans;
    const client = plan.clients;
    const taskMeta = (task.metadata || {}) as Record<string, unknown>;

    // 2. Fetch Brand Brain details for styling/color guidelines
    const { data: brain } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    const colors = brain?.colors || ["#000000"];
    const fonts = brain?.fonts || ["Montserrat"];
    const tone = brain?.caption_tone || "Professional, direct";
    const brandBrief = brain?.brand_brief || "";

    // Fetch shared agency brain digest
    const agencyBrainDigest = await getAgencyBrainDigest();

    // 3. Formulate Prompt based on Task Type
    let draftPrompt = "";
    const systemPrompt = `You are the AI Creative Producer for TBW Advertising. Generate precise campaign assets. 
Use these general agency guidelines and patterns to optimize the visual/copy hook if relevant:
${agencyBrainDigest}`;

    if (task.type === "copy") {
      draftPrompt = `Generate a first-draft COPY asset for this task.
      
      Task Details:
      - Concept: "${taskMeta.concept || ""}"
      - Format target: "${taskMeta.format || ""}"
      
      Client Brand Identity:
      - Brand Brief: "${brandBrief}"
      - Tone: "${tone}"
      - Preferred Fonts: ${JSON.stringify(fonts)}
      
      Generate a JSON object containing:
      - "headline": Short, punchy title.
      - "caption": Engaging post body copy matching the brand tone.
      - "cta": Compelling call to action.
      - "hashtags": 5-8 relevant hashtags.
      - "reel_script": If the target format is a reel/video, include a 30s video script layout. Otherwise return empty string.
      
      Output JSON strictly.`;
    } else if (task.type === "image") {
      draftPrompt = `Generate a first-draft IMAGE prompt for this task.
      
      Task Details:
      - Concept: "${taskMeta.concept || ""}"
      - Format target: "${taskMeta.format || ""}"
      
      Client Brand Identity:
      - Brand Brief: "${brandBrief}"
      - Colors Palette (Hex): ${JSON.stringify(colors)}
      - Visual Preferences: ${JSON.stringify(brain?.design_preferences || {})}
      
      Generate a JSON object containing:
      - "creative_concept": Overview of the visual idea.
      - "composition": Placement of items, lighting, and framing specs.
      - "image_prompt": A highly-detailed, comma-separated image generation prompt to feed into Midjourney/DALL-E, explicitly mentioning color HEX codes: ${colors.join(", ")} to enforce brand identity.
      
      Output JSON strictly.`;
    } else if (task.type === "video") {
      draftPrompt = `Generate a first-draft VIDEO prompt for this task.
      
      Task Details:
      - Concept: "${taskMeta.concept || ""}"
      - Format target: "${taskMeta.format || ""}"
      
      Client Brand Identity:
      - Brand Brief: "${brandBrief}"
      - Tone: "${tone}"
      - Colors Palette (Hex): ${JSON.stringify(colors)}
      
      Generate a JSON object containing:
      - "reel_concept": Direct hook and focal story.
      - "shot_list": Array of shot description strings.
      - "voiceover_script": Audio narration text.
      - "video_prompt": A Seedance 2.0 / Luma / Runway compatible video generation prompt incorporating brand colors.
      
      Output JSON strictly.`;
    } else {
      // General fallbacks
      draftPrompt = `Generate general creative recommendations for task concept: "${taskMeta.concept || ""}" based on brief: "${brandBrief}". Output JSON with "creative_notes".`;
    }

    // 4. Invoke LLM Complete with JSON schema
    let generatedContent = {};
    try {
      const response = await complete({
        model: MODEL_FAST,
        system: systemPrompt,
        messages: [{ role: "user", content: draftPrompt }],
        jsonSchema: {
          type: "object",
        },
      });

      if (response) {
        generatedContent = safeJsonParse(response, {});
      }
    } catch (llmErr) {
      console.error("AI Generation failed:", llmErr);
      return NextResponse.json({ error: "Generative model failed to respond" }, { status: 500 });
    }

    // 5. Update task row in DB
    const { error: updateErr } = await supabase
      .from("tasks")
      .update({
        draft_content: generatedContent,
      })
      .eq("id", id);

    if (updateErr) {
      throw updateErr;
    }

    return NextResponse.json({
      success: true,
      draftContent: generatedContent,
    });
  } catch (error: unknown) {
    console.error("AI Task Draft Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
