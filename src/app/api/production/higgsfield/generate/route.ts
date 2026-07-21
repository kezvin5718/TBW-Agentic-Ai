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
  formatHiggsfieldMedias,
  validateGenerationParamsLocally,
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

    if (productImages && Array.isArray(productImages) && productImages.length > 10) {
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

    // 2. Resolve Machine ID mapping ('nano_banana_pro', 'nano_banana_2')
    let selectedModel = model || HIGGSFIELD_CONFIG.defaultModel;
    if (HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models]) {
      selectedModel = HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models];
    }
    const selectedRatio = ratio || "3:4";

    // 3. Format reusable brand elements as <<<element_id>>> placeholders inside prompt text
    let formattedPrompt = formatPromptWithBrandElements(prompt, brandElementIds || []);
    if (styleReference?.mediaUrl) {
      formattedPrompt = `In the visual style and setting of reference image 1, featuring: ${formattedPrompt}`;
    }

    const batchCount = Array.isArray(productImages) && productImages.length > 0 ? productImages.length : 1;

    // 4. Preflight precise credit cost using params.get_cost: true
    const preflight = await getHiggsfieldGenerationCost(creds, selectedModel, batchCount, {
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
      prompt: `[Batch: ${batchCount}] [Preflighted: ${preflight.preflighted ? "Yes" : "Estimate"}] [Ratio: ${selectedRatio}] ${formattedPrompt}`,
      cost: totalCost,
    });

    if (costErr) {
      console.error("Failed to log Higgsfield cost:", costErr);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processedProductImages = (productImages || []).map((prod: any) => ({
      mediaUrl: prod.mediaUrl,
      mediaId: prod.higgsfieldMediaRef || prod.mediaId,
      higgsfieldMediaRef: prod.higgsfieldMediaRef || prod.mediaId,
    }));

    // Requirement 2: Block generation if any reference image lacks a confirmed Higgsfield media_id
    const unconfirmed = processedProductImages.find((p: { mediaId: string }) => !p.mediaId || p.mediaId.startsWith("higgs-media-ref") || p.mediaId.startsWith("media_id_prod"));
    if (unconfirmed) {
      return NextResponse.json(
        { error: "One or more reference images have not completed Higgsfield media import. Please re-upload the image." },
        { status: 400 }
      );
    }

    if (styleReference && (!styleReference.higgsfieldMediaRef || styleReference.higgsfieldMediaRef.startsWith("higgs-media-ref"))) {
      return NextResponse.json(
        { error: "Style reference image has not completed Higgsfield media import. Please re-upload the style image." },
        { status: 400 }
      );
    }

    // Requirement 1 & 2: Format medias using role: "image" for all media items. OMIT field when empty.
    const formattedMedias = formatHiggsfieldMedias(
      processedProductImages.map((p: { mediaId: string }) => p.mediaId),
      styleReference?.higgsfieldMediaRef || null,
      brandElementIds || []
    );

    // Requirement 2: Validate request parameters against model constraints locally before sending
    const modelInfo = creds.available_models_info?.find(m => m.id === selectedModel);
    const mediaRoles = formattedMedias ? formattedMedias.map(m => m.role) : [];
    const validation = validateGenerationParamsLocally(modelInfo, selectedRatio, mediaRoles);

    if (!validation.valid) {
      console.error(`❌ Higgsfield Local Model Validation Failed for '${selectedModel}': ${validation.error}`);
      return NextResponse.json(
        { error: `Validation Error: ${validation.error}` },
        { status: 400 }
      );
    }

    const generationParams: Record<string, unknown> = {
      model: selectedModel,
      prompt: formattedPrompt,
      aspect_ratio: selectedRatio,
      resolution: "1k",
    };

    if (formattedMedias && formattedMedias.length > 0) {
      generationParams.medias = formattedMedias;
    }

    // 5. Submit generation job via MCP wrapping arguments in { params: { ... } }
    console.log(`⚙️ Higgsfield MCP [Generation Submit]: Invoking generate_image tool with params wrapper...`);
    let toolRes: unknown;
    try {
      toolRes = await executeHiggsfieldGenerationTool(creds, "generate_image", generationParams);
    } catch (submitErr: unknown) {
      const submitMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
      console.error(`❌ Higgsfield MCP: generate_image tool submission failed: ${submitMsg}`);
      return NextResponse.json(
        { error: `Higgsfield generation failed: ${submitMsg}` },
        { status: 500 }
      );
    }

    // Log raw submission response once to confirm correct field
    console.log(`⚙️ Higgsfield MCP [RAW Submission Response]:\n${JSON.stringify(toolRes, null, 2)}`);

    const parsedTool = parseMCPToolResponse(toolRes);
    const extractedJobIds = parsedTool.jobIds || [];
    const realJobId = parsedTool.jobId || parsedTool.id || parsedTool.job_id || extractedJobIds[0];

    if (!realJobId && extractedJobIds.length === 0) {
      const errMsg = parsedTool.error || parsedTool.failure_reason || "Higgsfield server returned no valid job ID";
      console.error(`❌ Higgsfield MCP: Submission returned no job ID: ${errMsg}`);
      return NextResponse.json(
        { error: `Generation failed: ${errMsg}` },
        { status: 500 }
      );
    }

    const pollAfterSeconds = parsedTool.poll_after_seconds || 3;
    const allSubmittedJobIds = extractedJobIds.length > 0 ? extractedJobIds : [realJobId];
    console.log(`Job(s) submitted successfully: [${allSubmittedJobIds.join(", ")}]`);

    // Register active job state for every job in batch submission
    allSubmittedJobIds.forEach((jid: string) => {
      activeJobs.set(jid, {
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
    });

    return NextResponse.json({
      success: true,
      jobId: realJobId,
      jobIds: allSubmittedJobIds,
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
