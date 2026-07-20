import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify Founder access
    if (!user || user.user_metadata?.role !== "founder") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("agency_settings")
      .delete()
      .eq("key", "higgsfield_credentials");

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: "Higgsfield connection deleted successfully."
    });
  } catch (error: unknown) {
    console.error("Disconnect error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      success: false,
      error: `Failed to sever connection: ${msg}`
    }, { status: 500 });
  }
}
