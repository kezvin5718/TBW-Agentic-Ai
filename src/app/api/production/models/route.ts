import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    
    // Fetch higgsfield credentials containing available_models_info
    const { data: credsRow } = await supabase
      .from("agency_settings")
      .select("value")
      .eq("key", "higgsfield_credentials")
      .maybeSingle();
      
    const credsValue = credsRow?.value as Record<string, unknown> | null;
    const modelSpecs = credsValue?.available_models_info || [
      {
        id: "nano_banana_pro",
        name: "Nano Banana Pro",
        resolutions: ["1k", "2k"],
        allowed_resolutions: ["1k", "2k"]
      },
      {
        id: "Nano Banana Pro",
        name: "Nano Banana Pro",
        resolutions: ["1k", "2k"],
        allowed_resolutions: ["1k", "2k"]
      },
      {
        id: "nano_banana_2",
        name: "Nano Banana 2",
        resolutions: ["1k", "2k"],
        allowed_resolutions: ["1k", "2k"]
      },
      {
        id: "Nano Banana 2",
        name: "Nano Banana 2",
        resolutions: ["1k", "2k"],
        allowed_resolutions: ["1k", "2k"]
      },
      {
        id: "gpt_image_2",
        name: "GPT Image 2",
        resolutions: ["1k"],
        allowed_resolutions: ["1k"]
      },
      {
        id: "GPT Image 2",
        name: "GPT Image 2",
        resolutions: ["1k"],
        allowed_resolutions: ["1k"]
      }
    ];

    return NextResponse.json({
      success: true,
      models: modelSpecs
    });
  } catch (error: unknown) {
    console.error("Fetch models specs error:", error);
    return NextResponse.json({ error: "Failed to fetch model specifications" }, { status: 500 });
  }
}
