import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSnapshot } from "@/lib/portfolio-data";

// Founder-only personal portfolio monitor. Prices via Yahoo Finance chart API
// (free, ~15 min delayed — monitoring, not trading), news via Google News RSS.

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return new NextResponse("Unauthorized", { status: 401 });
    if (user.user_metadata?.role !== "founder") {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const snapshot = await buildSnapshot(true);
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error: unknown) {
    console.error("Founder portfolio fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
