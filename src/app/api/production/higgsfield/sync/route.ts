import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, syncHiggsfieldGenerations } from "@/lib/higgsfield-mcp";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creds = await getHiggsfieldCredentials();
    if (!creds || creds.status !== "connected") {
      return NextResponse.json({ error: "Higgsfield is not connected. Please connect first." }, { status: 400 });
    }

    const result = await syncHiggsfieldGenerations(creds, user.id);

    return NextResponse.json({
      success: true,
      importedCount: result.importedCount,
      records: result.records,
    });
  } catch (error) {
    console.error("Higgsfield sync error:", error);
    return NextResponse.json({ error: "Failed to sync generations from Higgsfield" }, { status: 500 });
  }
}
