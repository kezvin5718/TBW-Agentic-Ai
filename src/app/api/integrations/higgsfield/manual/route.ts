import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { discoverHiggsfieldModels, HiggsfieldCreds } from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Authenticate - Only allow Founder access
    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const accessToken = await request.json().then(b => b.accessToken);

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    // 2. Encrypt & format credentials payload
    const creds: HiggsfieldCreds = {
      access_token_encrypted: encrypt(accessToken.trim()),
      refresh_token_encrypted: encrypt(""), // Manual token doesn't have a refresh token
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year validity
      connected_as: "Manual Token",
      status: "connected",
    };

    // 3. Save to database in agency_settings
    const adminSupabase = createServiceRoleClient();
    const { error: upsertError } = await adminSupabase
      .from("agency_settings")
      .upsert({
        key: "higgsfield_credentials",
        value: creds,
      });

    if (upsertError) {
      throw upsertError;
    }

    // 4. Discover available Higgsfield models
    let discoveredModels: string[] = [];
    try {
      discoveredModels = await discoverHiggsfieldModels(creds);
    } catch (mcpErr) {
      console.warn("MCP model discovery warning during manual save:", mcpErr);
    }

    return NextResponse.json({
      success: true,
      message: "Manual Higgsfield token saved successfully.",
      models: discoveredModels
    });
  } catch (err: unknown) {
    console.error("Higgsfield manual token save error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 550 });
  }
}
