import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials } from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check user authenticated
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creds = await getHiggsfieldCredentials();

    if (!creds) {
      return NextResponse.json({
        connected: false,
        status: "disconnected"
      });
    }

    return NextResponse.json({
      connected: creds.status === "connected",
      status: creds.status,
      connectedAs: creds.connected_as || "Unknown User",
      models: creds.available_models || [],
      errorMessage: creds.error_message,
    });
  } catch (error: unknown) {
    console.error("Status endpoint error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
