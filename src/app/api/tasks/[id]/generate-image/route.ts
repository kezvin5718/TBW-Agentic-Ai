import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    const { engine, prompts, ratio } = await request.json();
    if (!engine) {
      return NextResponse.json({ error: "Image engine selection is required" }, { status: 400 });
    }

    // Determine cost and prompts to save
    let cost = 0.02;
    let finalPrompt = "";

    const ratioPrefix = ratio ? `[Ratio: ${ratio}] ` : "";

    if (engine === "nano_banana") {
      cost = 0.02;
      finalPrompt = ratioPrefix + (prompts?.nano_banana || "Nano Banana image prompt");
    } else if (engine === "gpt_image") {
      cost = 0.04;
      finalPrompt = ratioPrefix + (prompts?.gpt_image || "GPT Image prompt");
    } else if (engine === "both") {
      cost = 0.06;
      finalPrompt = `Nano: ${ratioPrefix}${prompts?.nano_banana || ""}\nGPT: ${ratioPrefix}${prompts?.gpt_image || ""}`;
    } else {
      return NextResponse.json({ error: "Invalid image engine selection" }, { status: 400 });
    }

    // Log the cost to gen_costs table
    const { error: costErr } = await supabase.from("gen_costs").insert({
      task_id: id,
      engine,
      prompt: finalPrompt,
      cost,
    });

    if (costErr) {
      console.error("Failed to log image generation costs:", costErr);
      // Proceed anyway to prevent blocking the UI
    }

    // Mock high-quality curated images from Unsplash
    const NANO_BANANA_URL = "https://images.unsplash.com/photo-1596797038530-2c107229654b?q=80&w=600&auto=format&fit=crop";
    const GPT_IMAGE_URL = "https://images.unsplash.com/photo-1606787366850-de6330128bfc?q=80&w=600&auto=format&fit=crop";

    let responseData = {};
    if (engine === "nano_banana") {
      responseData = {
        success: true,
        engine,
        mediaUrl: NANO_BANANA_URL,
        cost,
      };
    } else if (engine === "gpt_image") {
      responseData = {
        success: true,
        engine,
        mediaUrl: GPT_IMAGE_URL,
        cost,
      };
    } else {
      responseData = {
        success: true,
        engine,
        mediaUrls: {
          nano_banana: NANO_BANANA_URL,
          gpt_image: GPT_IMAGE_URL,
        },
        cost,
      };
    }

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    console.error("Image Generation Route Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
