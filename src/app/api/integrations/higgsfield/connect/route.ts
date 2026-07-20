import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Only allow Founder access
    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const clientId = process.env.HIGGSFIELD_CLIENT_ID || "claude";
    const redirectUri = "https://bron.digital/api/integrations/higgsfield/callback";
    const state = Math.random().toString(36).substring(2, 15);

    // 1. Generate PKCE Verifier and Challenge
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    // 2. Build authorization URL
    const authUrl = new URL("https://mcp.higgsfield.ai/oauth2/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email offline_access");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(authUrl.toString());
    
    // Save state in cookie
    response.cookies.set("higgsfield_oauth_state", state, {
      path: "/",
      maxAge: 300, // 5 minutes
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });

    // Save verifier in cookie
    response.cookies.set("higgsfield_oauth_verifier", verifier, {
      path: "/",
      maxAge: 300, // 5 minutes
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });

    return response;
  } catch (error: unknown) {
    console.error("Connect redirect error:", error);
    return new NextResponse("Failed to initiate Higgsfield OAuth flow", { status: 500 });
  }
}
