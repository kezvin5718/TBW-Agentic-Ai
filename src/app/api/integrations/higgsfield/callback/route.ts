import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { discoverHiggsfieldModels, HiggsfieldCreds } from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";

const HIGGSFIELD_OAUTH_TOKEN_URL = "https://mcp.higgsfield.ai/oauth/token";
const CLIENT_ID = process.env.HIGGSFIELD_CLIENT_ID || "tbw_os_client";
const CLIENT_SECRET = process.env.HIGGSFIELD_CLIENT_SECRET || "tbw_os_secret";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const stateCookie = request.cookies.get("higgsfield_oauth_state")?.value;

  if (errorParam) {
    console.error("Higgsfield OAuth callback returned error:", errorParam);
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?error=" + errorParam, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?error=missing_code", request.url));
  }

  // Validate state to prevent CSRF
  if (!state || state !== stateCookie) {
    console.error("Higgsfield CSRF check failed. State mismatch.");
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?error=invalid_state", request.url));
  }

  try {
    const supabase = await createClient();

    // 1. Exchange Auth Code for Access Token
    const res = await fetch(HIGGSFIELD_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://bron.digital/api/integrations/higgsfield/callback",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Token exchange failed: ${res.statusText} - ${errText}`);
    }

    const tokenData = await res.json();
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    // 2. Encrypt & format credentials payload
    const creds: HiggsfieldCreds = {
      access_token_encrypted: encrypt(tokenData.access_token),
      refresh_token_encrypted: encrypt(tokenData.refresh_token || ""),
      expires_at: expiresAt,
      connected_as: tokenData.user_email || tokenData.username || "Higgsfield User",
      status: "connected",
    };

    // 3. Upsert key in agency_settings table
    const { error: upsertError } = await supabase
      .from("agency_settings")
      .upsert({
        key: "higgsfield_credentials",
        value: creds,
      });

    if (upsertError) {
      throw upsertError;
    }

    // 4. Auto-discover available Higgsfield model configurations
    try {
      await discoverHiggsfieldModels(creds);
    } catch (mcpErr) {
      console.warn("MCP model discovery warning:", mcpErr);
    }

    // 5. Clear state cookie and redirect back to integrations page with success flag
    const response = NextResponse.redirect(new URL("/dashboard/settings/integrations?success=true", request.url));
    response.cookies.delete("higgsfield_oauth_state");
    return response;
  } catch (err: unknown) {
    console.error("Higgsfield callback execution error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/integrations?error=exchange_failed&details=${encodeURIComponent(msg)}`, request.url)
    );
  }
}
