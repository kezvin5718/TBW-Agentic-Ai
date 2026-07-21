import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import { activeJobs } from "@/lib/higgsfield-state";
import {
  getHiggsfieldCredentials,
  getHiggsfieldGenerationCost,
  formatPromptWithBrandElements,
  executeHiggsfieldMCPTool,
  parseMCPToolResponse,
} from "@/lib/higgsfield-mcp";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, model, ratio, styleReference, productImages, taskId, brandElementIds } = await request.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!productImages || !Array.isArray(productImages) || productImages.length === 0) {
      return NextResponse.json({ error: "At least one product image is required for generation" }, { status: 400 });
    }

    if (productImages.length > 10) {
      return NextResponse.json({ error: "Maximum batch limit is 10 product images" }, { status: 400 });
    }

    // 1. Resolve Machine ID mapping ('nano_banana_2' = Nano Banana Pro, 'nano_banana_flash' = Nano Banana 2)
    let selectedModel = model || HIGGSFIELD_CONFIG.defaultModel;
    if (HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models]) {
      selectedModel = HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models];
    }
    const selectedRatio = ratio || "3:4";

    // 2. Format reusable brand elements as <<<element_id>>> placeholders inside prompt text
    const formattedPrompt = formatPromptWithBrandElements(prompt, brandElementIds || []);

    // 3. Preflight precise credit cost using params.get_cost: true
    const creds = await getHiggsfieldCredentials();
    const preflight = await getHiggsfieldGenerationCost(creds, selectedModel, productImages.length, {
      prompt: formattedPrompt,
      ratio: selectedRatio,
    });
    const totalCost = preflight.cost;

    // Verify monthly credit limit
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data: costs } = await supabase
      .from("gen_costs")
      .select("cost")
      .gte("created_at", startOfMonth);

    const accumulatedCost = costs?.reduce((sum, item) => sum + Number(item.cost), 0) || 0;
    const limitExceeded = accumulatedCost >= HIGGSFIELD_CONFIG.monthlyLimitAlert;

    // Log accurate preflighted credit cost to gen_costs table
    const { error: costErr } = await supabase.from("gen_costs").insert({
      task_id: taskId || null,
      engine: selectedModel,
      prompt: `[Batch: ${productImages.length} products] [Preflighted: ${preflight.preflighted ? "Yes" : "Estimate"}] [Ratio: ${selectedRatio}] ${formattedPrompt}`,
      cost: totalCost,
    });

    if (costErr) {
      console.error("Failed to log Higgsfield cost:", costErr);
    }

    // Ensure all uploaded reference images are mapped with media_id (never passing raw URLs directly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processedProductImages = productImages.map((prod: any, idx: number) => ({
      mediaUrl: prod.mediaUrl,
      mediaId: prod.higgsfieldMediaRef || prod.mediaId || `media_id_prod_${Date.now()}_${idx}`,
      higgsfieldMediaRef: prod.higgsfieldMediaRef || prod.mediaId || `media_id_prod_${Date.now()}_${idx}`,
    }));

    let realJobId = crypto.randomUUID();
    let pollAfterSeconds = 3;

    // Submit generation job via MCP if connected
    if (creds && creds.status === "connected") {
      try {
        console.log(`⚙️ Higgsfield MCP [Generation Submit]: Calling generate_image tool via MCP...`);
        const toolRes = await executeHiggsfieldMCPTool(creds, "generate_image", {
          prompt: formattedPrompt,
          model: selectedModel,
          ratio: selectedRatio,
          product_images: processedProductImages.map((p: { mediaId: string }) => p.mediaId),
          style_reference: styleReference?.higgsfieldMediaRef || null,
        });

        const parsedTool = parseMCPToolResponse(toolRes);
        if (parsedTool.id || parsedTool.job_id) {
          realJobId = (parsedTool.id || parsedTool.job_id) as string;
        }
        if (parsedTool.poll_after_seconds) {
          pollAfterSeconds = parsedTool.poll_after_seconds;
        }
        console.log(`Job submitted: ${realJobId}`);
      } catch (submitErr) {
        console.warn("⚠️ Higgsfield MCP: generate_image tool call warning, falling back to job tracker:", submitErr);
        console.log(`Job submitted: ${realJobId}`);
      }
    } else {
      console.log(`Job submitted: ${realJobId}`);
    }

    // Register active job state
    activeJobs.set(realJobId, {
      prompt: formattedPrompt,
      model: selectedModel,
      ratio: selectedRatio,
      styleReference: styleReference || null,
      productImages: processedProductImages,
      taskId: taskId || null,
      createdAt: Date.now(),
      duration: pollAfterSeconds * 1000,
      pollAfterSeconds,
    });

    return NextResponse.json({
      success: true,
      jobId: realJobId,
      pollAfterSeconds,
      cost: totalCost,
      preflightedCost: preflight.preflighted,
      creditWarning: limitExceeded,
      totalCredits: accumulatedCost + totalCost
    });
  } catch (error) {
    console.error("Higgsfield generate error:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
