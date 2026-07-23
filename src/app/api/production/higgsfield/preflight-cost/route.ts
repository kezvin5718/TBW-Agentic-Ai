import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, getHiggsfieldGenerationCost } from "@/lib/higgsfield-mcp";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { model, batchCount, prompt, categoryId } = await request.json();

    // Check category engine
    let categoryEngine = "higgsfield";
    if (categoryId) {
      const { data: catData, error: catErr } = await supabase
        .from("generation_categories")
        .select("name, engine")
        .eq("id", categoryId)
        .single();
      if (catErr) {
        const { data: legacyCatData } = await supabase
          .from("generation_categories")
          .select("name")
          .eq("id", categoryId)
          .single();
        if (legacyCatData?.name === "Festival Post") {
          categoryEngine = "higgsfield";
        }
      } else if (catData) {
        categoryEngine = catData.engine || "higgsfield";
        if (catData.name === "Festival Post") {
          categoryEngine = "higgsfield";
        }
      }
    }

    if (categoryEngine === "openai" || model === "openai") {
      return NextResponse.json({
        success: true,
        cost: 2.0 * (batchCount || 1),
        preflighted: true,
      });
    }

    // Resolve model machine ID
    let modelMachineId = model || HIGGSFIELD_CONFIG.defaultModel;
    if (HIGGSFIELD_CONFIG.models[modelMachineId as keyof typeof HIGGSFIELD_CONFIG.models]) {
      modelMachineId = HIGGSFIELD_CONFIG.models[modelMachineId as keyof typeof HIGGSFIELD_CONFIG.models];
    }

    const creds = await getHiggsfieldCredentials();
    const preflight = await getHiggsfieldGenerationCost(creds, modelMachineId, batchCount || 1, { prompt });

    return NextResponse.json({
      success: true,
      cost: preflight.cost,
      preflighted: preflight.preflighted,
    });
  } catch (error) {
    console.error("Higgsfield preflight cost error:", error);
    return NextResponse.json({ error: "Failed to fetch preflight cost" }, { status: 500 });
  }
}
