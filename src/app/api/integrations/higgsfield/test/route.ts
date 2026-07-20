import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, discoverHiggsfieldModels } from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify Founder access
    if (!user || user.user_metadata?.role !== "founder") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creds = await getHiggsfieldCredentials();

    if (!creds) {
      return NextResponse.json({
        success: false,
        error: "Higgsfield not connected. Please connect first."
      }, { status: 400 });
    }

    // Run connection test and discover models
    const models = await discoverHiggsfieldModels(creds);

    return NextResponse.json({
      success: true,
      models,
    });
  } catch (error: unknown) {
    console.error("Test integration error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      success: false,
      error: `Connection test failed: ${msg}`
    });
  }
}
