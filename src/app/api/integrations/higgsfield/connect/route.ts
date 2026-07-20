import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DBOAuthClientProvider, getBaseAppUrl } from "@/lib/higgsfield-mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Only allow Founder access
    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("⚙️ Higgsfield MCP [Connect Route]: Starting DBOAuthClientProvider authorization orchestrator...");
    
    const provider = new DBOAuthClientProvider();
    
    // Run the official SDK's built-in discovery, registration, and challenge start
    const result = await auth(provider, {
      serverUrl: "https://mcp.higgsfield.ai/mcp"
    });

    if (result === "REDIRECT") {
      const authRedirectUrl = provider.getAuthorizationUrl();
      if (authRedirectUrl) {
        console.log("⚙️ Higgsfield MCP [Connect Route]: Redirecting user to authorization URL.");
        return NextResponse.redirect(authRedirectUrl.toString());
      }
      throw new Error("SDK auth returned REDIRECT but provider had no authorization URL saved.");
    }

    console.log("⚙️ Higgsfield MCP [Connect Route]: Auth completed synchronously with result:", result);
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?success=true", getBaseAppUrl()));
  } catch (error: unknown) {
    console.error("❌ Higgsfield MCP [Connect Route] Failure:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/integrations?error=connect_failed&details=${encodeURIComponent(msg)}`, getBaseAppUrl())
    );
  }
}
