import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import { activeJobs } from "@/lib/higgsfield-state";
import {
  getHiggsfieldCredentials,
  getHiggsfieldGenerationCost,
  formatPromptWithBrandElements,
  executeHiggsfieldGenerationTool,
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

    // 1. Connection check - fail loudly if Higgsfield is not connected
    const creds = await getHiggsfieldCredentials();
    if (!creds || creds.status !== "connected") {
      return NextResponse.json(
        { error: "Higgsfield MCP is not connected. Please connect Higgsfield in Settings -> Integrations first." },
        { status: 400 }
      );
    }

    // 2. Resolve Machine ID mapping ('nano_banana_2' = Nano Banana Pro, 'nano_banana_flash' = Nano Banana 2)
    let selectedModel = model || HIGGSFIELD_CONFIG.defaultModel;
    if (HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models]) {
      selectedModel = HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models];
    }
    const selectedRatio = ratio || "3:4";

    // 3. Format reusable brand elements as <<<element_id>>> placeholders inside prompt text
    const formattedPrompt = formatPromptWithBrandElements(prompt, brandElementIds || []);

    // 4. Preflight precise credit cost using params.get_cost: true
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

    // 5. Submit generation job via MCP wrapping arguments in { params: { ... } } (Requirement 1)
    console.log(`⚙️ Higgsfield MCP [Generation Submit]: Invoking generate_image tool with params wrapper...`);
    let toolRes: unknown;
    try {
      toolRes = await executeHiggsfieldGenerationTool(creds, "generate_image", {
        model: selectedModel,
        prompt: formattedPrompt,
        aspect_ratio: selectedRatio,
        ratio: selectedRatio,
        resolution: HIGGSFIELD_CONFIG.resolution || "1K",
        medias: processedProductImages.map((p: { mediaId: string }) => p.mediaId),
        reference_images: processedProductImages.map((p: { mediaId: string }) => p.mediaId),
        product_images: processedProductImages.map((p: { mediaId: string }) => p.mediaId),
        style_reference: styleReference?.higgsfieldMediaRef || null,
      });
    } catch (submitErr: unknown) {
      // Requirement 2: NO FAKE-JOB FALLBACK — fail loudly!
      const submitMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
      console.error(`❌ Higgsfield MCP: generate_image tool submission failed: ${submitMsg}`);
      return NextResponse.json(
        { error: `Higgsfield generation failed: ${submitMsg}` },
        { status: 500 }
      );
    }

    // Requirement 1: Log raw submission response once to confirm correct field
    console.log(`⚙️ Higgsfield MCP [RAW Submission Response]:\n${JSON.stringify(toolRes, null, 2)}`);

    const parsedTool = parseMCPToolResponse(toolRes);
    const realJobId = parsedTool.jobId || parsedTool.id || parsedTool.job_id;

    // Requirement 2: If no valid job ID returned, fail loudly!
    if (!realJobId) {
      const errMsg = parsedTool.error || parsedTool.failure_reason || "Higgsfield server returned no valid job ID";
      console.error(`❌ Higgsfield MCP: Submission returned no job ID: ${errMsg}`);
      return NextResponse.json(
        { error: `Generation failed: ${errMsg}` },
        { status: 500 }
      );
    }

    const pollAfterSeconds = parsedTool.poll_after_seconds || 3;
    console.log(`Job submitted: ${realJobId}`);

    // Register active job state only on genuine submission success
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Higgsfield generate error:", error);
    return NextResponse.json({ error: `Generation failed: ${msg}` }, { status: 500 });
  }
}
