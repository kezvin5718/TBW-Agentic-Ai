import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

// Global in-memory job store for simulating asynchronous generation delays
export const activeJobs = new Map<string, {
  prompt: string;
  model: string;
  ratio: string;
  styleReference: { mediaUrl: string; higgsfieldMediaRef: string } | null;
  productImages: Array<{ mediaUrl: string; higgsfieldMediaRef: string }>;
  taskId?: string | null;
  createdAt: number;
  duration: number; // in ms
}>();

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, model, ratio, styleReference, productImages, taskId } = await request.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!productImages || !Array.isArray(productImages) || productImages.length === 0) {
      return NextResponse.json({ error: "At least one product image is required for generation" }, { status: 400 });
    }

    if (productImages.length > 10) {
      return NextResponse.json({ error: "Maximum batch limit is 10 product images" }, { status: 400 });
    }

    const selectedModel = model || HIGGSFIELD_CONFIG.defaultModel;
    const selectedRatio = ratio || "3:4";
    
    // Calculate cost based on model type and product count (styleReference does not add to generation cost)
    const costPerImage = HIGGSFIELD_CONFIG.modelCosts[selectedModel as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;
    const totalCost = costPerImage * productImages.length;

    // Verify monthly credit limit
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data: costs } = await supabase
      .from("gen_costs")
      .select("cost")
      .gte("created_at", startOfMonth);

    const accumulatedCost = costs?.reduce((sum, item) => sum + Number(item.cost), 0) || 0;
    const limitExceeded = accumulatedCost >= HIGGSFIELD_CONFIG.monthlyLimitAlert;

    // Log the cost to gen_costs table linked to the task
    const { error: costErr } = await supabase.from("gen_costs").insert({
      task_id: taskId || null,
      engine: selectedModel,
      prompt: `[Batch: ${productImages.length} products] [Style Ref: ${styleReference ? "Yes" : "No"}] [Ratio: ${selectedRatio}] ${prompt}`,
      cost: totalCost,
    });

    if (costErr) {
      console.error("Failed to log Higgsfield cost:", costErr);
    }

    // Generate a jobId and register in activeJobs
    const jobId = crypto.randomUUID();
    activeJobs.set(jobId, {
      prompt,
      model: selectedModel,
      ratio: selectedRatio,
      styleReference: styleReference || null,
      productImages,
      taskId: taskId || null,
      createdAt: Date.now(),
      duration: 4000, // 4 seconds of simulated processing
    });

    return NextResponse.json({
      success: true,
      jobId,
      creditWarning: limitExceeded,
      totalCredits: accumulatedCost + totalCost
    });
  } catch (error) {
    console.error("Higgsfield generate error:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
