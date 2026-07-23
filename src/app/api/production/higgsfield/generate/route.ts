import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { activeJobs } from "@/lib/higgsfield-state";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  getHiggsfieldCredentials,
  getHiggsfieldGenerationCost,
  formatPromptWithBrandElements,
  executeHiggsfieldGenerationTool,
  parseMCPToolResponse,
  formatHiggsfieldMedias,
  validateGenerationParamsLocally,
  getReferenceCleanupTemplate,
  type HiggsfieldCreds,
} from "@/lib/higgsfield-mcp";

const clientStyleCache = new Map<string, { block: string; timestamp: number }>();

async function getCondensedClientStyle(supabase: SupabaseClient, clientId: string): Promise<string> {
  const cacheKey = clientId;
  const cached = clientStyleCache.get(cacheKey);
  // Cache for 10 minutes to prevent redundant LLM calls in batch submissions
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.block;
  }

  try {
    // 1. Fetch client details
    const { data: client } = await supabase
      .from("clients")
      .select("name, products, target_audience")
      .eq("id", clientId)
      .single();

    // 2. Fetch brand brain details
    const { data: brandBrain } = await supabase
      .from("brand_brain")
      .select("colors, caption_tone, design_preferences, brand_brief")
      .eq("client_id", clientId)
      .single();

    if (!client || !brandBrain) {
      return "";
    }

    const brandName = client.name;
    const tone = brandBrain.caption_tone || "Not set";
    const colors = JSON.stringify(brandBrain.colors || []);
    const preferences = JSON.stringify(brandBrain.design_preferences || {});
    const brief = brandBrain.brand_brief || "Not set";

    const promptText = `You are a design and branding strategist. Condense the visual branding rules and preferences of the brand "${brandName}" into a concise visual style instructions block.

Tone: ${tone}
Color Palette Hexes: ${colors}
Visual Preferences: ${preferences}
Brand Brief Summary: ${brief}

Strict Output Rules:
1. Condense into a single visual style guideline statement.
2. Focus ONLY on colors, visual rules, visual do's and don'ts, photography aesthetic.
3. Maximum 100 words.
4. Output only the condensed style block raw text. No intro, no explanation, no markdown code block formatting.`;

    const response = await complete({
      model: MODEL_SMART,
      system: "You are a brand brief synthesizer. You output highly condensed style blocks under 100 words.",
      messages: [{ role: "user", content: promptText }],
    });

    const styleBlock = response ? response.trim() : "";
    if (styleBlock) {
      clientStyleCache.set(cacheKey, { block: styleBlock, timestamp: Date.now() });
      return styleBlock;
    }
  } catch (err) {
    console.error("Failed to generate condensed style block:", err);
  }

  return "";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyData = await request.json();
    const { 
      prompt, 
      model, 
      ratio, 
      styleReference, 
      productImages, 
      taskId, 
      brandElementIds, 
      branding, 
      categoryId, 
      rawInput, 
      clientId,
      festivalName,
      festivalDetails,
      festivalWish,
      festivalTagline 
    } = bodyData;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (productImages && Array.isArray(productImages) && productImages.length > 10) {
      return NextResponse.json({ error: "Maximum batch limit is 10 product images" }, { status: 400 });
    }

    // Resolve category type and engine
    let categoryEngine = "higgsfield";
    let categoryType = "standard";
    let categoryData: { prompt_prefix?: string; prompt_suffix?: string; scaffold_json?: unknown } | null = null;

    if (categoryId) {
      const { data: catData, error: catErr } = await supabase
        .from("generation_categories")
        .select("name, engine, category_type, prompt_prefix, prompt_suffix, scaffold_json")
        .eq("id", categoryId)
        .single();
      if (!catErr && catData) {
        categoryEngine = catData.engine || "higgsfield";
        if ((catData as { name?: string }).name === "Festival Post") {
          categoryEngine = "higgsfield";
        }
        categoryType = catData.category_type || "standard";
        categoryData = catData;
      } else {
        const { data: legacyCat } = await supabase
          .from("generation_categories")
          .select("name, prompt_prefix, prompt_suffix, default_model")
          .eq("id", categoryId)
          .single();
        if (legacyCat) {
          const isFestival = legacyCat.name === "Festival Post";
          categoryEngine = isFestival ? "higgsfield" : "higgsfield";
          categoryType = isFestival ? "festival_post" : "standard";
          categoryData = {
            prompt_prefix: legacyCat.prompt_prefix || "",
            prompt_suffix: legacyCat.prompt_suffix || "",
            scaffold_json: isFestival ? {
              prompt: "A premium, minimalist 9:16 story-format festive creative for {festival_name}. Design style: {festival_details}. Aesthetic guidelines: use clean motifs and rich colors appropriate to {festival_name}, ensuring elegant negative space and safe margins for the 9:16 frame. Text Wish: {wish_text}. Tagline: {tagline_text}. Instructions: Render the typography clean and keep the text strings extremely short and exactly spelled as specified. If Wish or Tagline is empty, render NO text in the creative. Do not invent any text. Place the product seamlessly in the scene, adapting the styling to the product segments. House style: premium, elegant, minimal, no clutter."
            } : null
          };
        }
      }
    }

    // 1. Connection check - fail loudly only if engine is Higgsfield
    let creds: HiggsfieldCreds | null = null;
    if (categoryEngine !== "openai") {
      creds = await getHiggsfieldCredentials();
      if (!creds || creds.status !== "connected") {
        return NextResponse.json(
          { error: "Higgsfield MCP is not connected. Please connect Higgsfield in Settings -> Integrations first." },
          { status: 400 }
        );
      }
    }

    // 2. Resolve Machine ID mapping ('nano_banana_pro', 'nano_banana_2')
    let selectedModel = model || HIGGSFIELD_CONFIG.defaultModel;
    if (categoryEngine !== "openai" && HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models]) {
      selectedModel = HIGGSFIELD_CONFIG.models[selectedModel as keyof typeof HIGGSFIELD_CONFIG.models];
    }
    const selectedRatio = ratio || "3:4";

    // Resolve client style context if client is selected
    let clientStyleBlock = "";
    if (clientId) {
      clientStyleBlock = await getCondensedClientStyle(supabase, clientId);
    }

    // Resolve style reference disambiguation block if style reference is attached
    let disambiguationBlock = "";
    const hasStyleRef = !!(styleReference?.higgsfieldMediaRef || styleReference?.mediaUrl);
    if (hasStyleRef) {
      disambiguationBlock = "Image 1 is a STYLE/SCENE reference only — use its surface, background, lighting, mood and props, but do NOT reproduce any jewellery or products visible in it. Image 2 contains the ACTUAL PRODUCT: render exactly this product, preserving its design 100%, placed into the style of image 1.";
    }

    const userInputText = rawInput || prompt;

    // Compose inner combined parts
    const combinedParts = [];
    if (clientStyleBlock) {
      combinedParts.push(`Visual Style: ${clientStyleBlock.trim()}.`);
    }
    if (disambiguationBlock) {
      combinedParts.push(disambiguationBlock);
    }
    combinedParts.push(userInputText.trim());
    const combinedInput = combinedParts.join(" ");

    let scaffoldedPrompt = prompt;

    if (categoryId && categoryData) {
        if (categoryType === "festival_post" && categoryData.scaffold_json) {
          const wishTextVal = festivalWish ? `"${festivalWish}"` : "NONE (do NOT render any text)";
          const taglineTextVal = festivalTagline ? `"${festivalTagline}"` : "NONE (do NOT render any tagline)";
          const serialized = typeof categoryData.scaffold_json === "string"
            ? categoryData.scaffold_json
            : JSON.stringify(categoryData.scaffold_json);
          scaffoldedPrompt = serialized
            .replace(/{festival_name}/g, festivalName || "Festival")
            .replace(/{festival_details}/g, festivalDetails || "premium design motifs")
            .replace(/{wish_text}/g, wishTextVal)
            .replace(/{tagline_text}/g, taglineTextVal);
        } else if (categoryData.scaffold_json) {
          const userInputReplacement = combinedInput.trim() ? combinedInput : "as per the reference image";
          const serialized = typeof categoryData.scaffold_json === "string"
            ? categoryData.scaffold_json
            : JSON.stringify(categoryData.scaffold_json);
          scaffoldedPrompt = serialized.replace(/{user_input}/g, userInputReplacement);
        } else {
          let prefix = categoryData.prompt_prefix || "";
          const suffix = categoryData.prompt_suffix || "";

          // Grammar fix: check if user input starts with a preposition
          if (prefix.toLowerCase().trim().endsWith(" of")) {
            const prepositionPattern = /^(on|in|against|under|with|at|above|behind|beside|between|over|through|upon|inside|outside)\b/i;
            if (prepositionPattern.test(userInputText.trim())) {
              // Strip "of" from the prefix if user input describes a scene/preposition
              prefix = prefix.replace(/\s+of\s*$/i, "").trim();
            }
          }

          // Compose inner text for simple prefix/suffix
          const innerParts = [];
          if (clientStyleBlock) {
            innerParts.push(`Visual Style: ${clientStyleBlock.trim()}.`);
          }
          if (disambiguationBlock) {
            innerParts.push(disambiguationBlock);
          }
          innerParts.push(userInputText);

          const innerText = innerParts.join(" ");
          scaffoldedPrompt = `${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${innerText}${suffix}`;
        }
    } else {
      scaffoldedPrompt = combinedInput;
    }

    // 3. Format reusable brand elements as <<<element_id>>> placeholders inside prompt text
    let formattedPrompt = formatPromptWithBrandElements(scaffoldedPrompt, brandElementIds || []);
    if (styleReference?.mediaUrl) {
      formattedPrompt = `In the visual style and setting of reference image 1, featuring: ${formattedPrompt}`;
    }

    // Requirement 1: Reference Cleanup (always on when reference attached)
    // Fetch editable template from prompt-templates config/DB instead of hardcoding
    const hasReference = !!styleReference?.mediaUrl || (productImages && productImages.length > 0);
    if (hasReference) {
      const cleanupTemplate = await getReferenceCleanupTemplate();
      if (cleanupTemplate && !formattedPrompt.toLowerCase().includes("completely clean image")) {
        formattedPrompt = `${formattedPrompt} ${cleanupTemplate}`;
      }
    }

    // Log the final composed prompt per generation
    console.log(`⚙️ Higgsfield MCP [Final Composed Prompt]:\n${formattedPrompt}`);

    const batchCount = Array.isArray(productImages) && productImages.length > 0 ? productImages.length : 1;

    // 4. Preflight precise credit cost
    let totalCost = 0;
    let preflighted = false;

    if (categoryEngine === "openai") {
      totalCost = 2.0 * batchCount; // OpenAI Image generation cost
      preflighted = true;
    } else {
      const preflight = await getHiggsfieldGenerationCost(creds, selectedModel, batchCount, {
        prompt: formattedPrompt,
        ratio: selectedRatio,
      });
      totalCost = preflight.cost;
      preflighted = preflight.preflighted;
    }

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
      engine: categoryEngine === "openai" ? "openai" : selectedModel,
      prompt: `[Batch: ${batchCount}] [Preflighted: ${preflighted ? "Yes" : "Estimate"}] [Ratio: ${selectedRatio}] ${formattedPrompt}`,
      cost: totalCost,
    });

    if (costErr) {
      console.error("Failed to log generation cost:", costErr);
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

    // Route to OpenAI engine if requested
    if (categoryEngine === "openai") {
      const crypto = await import("crypto");
      const openaiJobId = `openai-job-${crypto.randomUUID().slice(0, 8)}`;
      
      activeJobs.set(openaiJobId, {
        prompt: formattedPrompt,
        model: "dall-e-3",
        ratio: selectedRatio,
        styleReference: styleReference || null,
        productImages: processedProductImages,
        taskId: taskId || null,
        createdAt: Date.now(),
        duration: 8000,
        pollAfterSeconds: 2,
        branding: branding || undefined,
        categoryId: categoryId || undefined,
        rawInput: rawInput || undefined,
        engine: "openai",
      });

      return NextResponse.json({
        success: true,
        jobId: openaiJobId,
        jobIds: [openaiJobId],
        pollAfterSeconds: 2,
        cost: totalCost,
        preflightedCost: true,
        creditWarning: limitExceeded,
        totalCredits: accumulatedCost + totalCost
      });
    }

    // Requirement 1 & 2: Format medias using role: "image" for all media items. OMIT field when empty.
    const formattedMedias = formatHiggsfieldMedias(
      processedProductImages.map((p: { mediaId: string }) => p.mediaId),
      styleReference?.higgsfieldMediaRef || null,
      brandElementIds || []
    );

    // Requirement 2: Validate request parameters against model constraints locally before sending
    const modelInfo = creds?.available_models_info?.find((m: { id: string }) => m.id === selectedModel);
    const mediaRoles = formattedMedias ? formattedMedias.map((m: { role: string }) => m.role) : [];
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

    // Log per-job medias (media_ids attached, in what order)
    console.log(`⚙️ Higgsfield MCP [Generation Media Order]: ${JSON.stringify(generationParams.medias || [])}`);

    // 5. Submit generation job via MCP wrapping arguments in { params: { ... } }
    console.log(`⚙️ Higgsfield MCP [Generation Submit]: Invoking generate_image tool with params wrapper...`);
    let toolRes: unknown;
    try {
      toolRes = await executeHiggsfieldGenerationTool(creds!, "generate_image", generationParams);
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
        branding: branding || undefined,
        categoryId: categoryId || undefined,
        rawInput: rawInput || undefined,
      });
    });

    return NextResponse.json({
      success: true,
      jobId: realJobId,
      jobIds: allSubmittedJobIds,
      pollAfterSeconds,
      cost: totalCost,
      preflightedCost: preflighted,
      creditWarning: limitExceeded,
      totalCredits: accumulatedCost + totalCost
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Higgsfield generate error:", error);
    return NextResponse.json({ error: `Generation failed: ${msg}` }, { status: 500 });
  }
}
