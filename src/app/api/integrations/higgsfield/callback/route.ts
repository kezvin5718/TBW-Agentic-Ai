import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DBOAuthClientProvider, discoverHiggsfieldModels, getHiggsfieldCredentials, getBaseAppUrl } from "@/lib/higgsfield-mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    console.error("❌ Higgsfield OAuth callback returned error:", errorParam);
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?error=" + errorParam, getBaseAppUrl()));
  }

  if (!code) {
    console.error("❌ Higgsfield OAuth callback: missing authorization code");
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?error=missing_code", getBaseAppUrl()));
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify authenticated user (only founder allows completing flow)
    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("⚙️ Higgsfield MCP [Callback Route]: Starting DBOAuthClientProvider callback exchange...");

    const provider = new DBOAuthClientProvider();

    // Run the official SDK's built-in token exchange flow
    const result = await auth(provider, {
      serverUrl: "https://mcp.higgsfield.ai/mcp",
      authorizationCode: code,
    });

    if (result !== "AUTHORIZED") {
      throw new Error(`SDK auth returned unexpected callback result: ${result}`);
    }

    // Load credentials we just saved to run model discovery
    const creds = await getHiggsfieldCredentials();
    if (creds) {
      try {
        console.log("⚙️ Higgsfield MCP [Callback Route]: Triggering model discovery...");
        await discoverHiggsfieldModels(creds);
      } catch (discoveryErr) {
        console.warn("⚠️ Higgsfield MCP [Callback Route]: Model discovery warning:", discoveryErr);
      }
    }

    console.log("⚙️ Higgsfield MCP [Callback Route]: Callback completed successfully.");
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?success=true", getBaseAppUrl()));
  } catch (err: unknown) {
    console.error("❌ Higgsfield MCP [Callback Route] Failure:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/integrations?error=exchange_failed&details=${encodeURIComponent(msg)}`, getBaseAppUrl())
    );
  }
}
