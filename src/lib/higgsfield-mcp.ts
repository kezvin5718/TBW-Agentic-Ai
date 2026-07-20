import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import { cookies } from "next/headers";
import { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface HiggsfieldCreds {
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string; // ISO 8601
  connected_as?: string;
  status: "connected" | "disconnected" | "error";
  error_message?: string;
  available_models?: string[];
}

const HIGGSFIELD_OAUTH_TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";

const CLIENT_ID = process.env.HIGGSFIELD_CLIENT_ID || "claude";
const CLIENT_SECRET = process.env.HIGGSFIELD_CLIENT_SECRET || "";

/**
 * Fetch and decrypt the Higgsfield integration credentials from the database.
 * Auto-refreshes the access token if it has expired or is close to expiring.
 */
export async function getHiggsfieldCredentials(): Promise<HiggsfieldCreds | null> {
  // 1. Check if static environment token is configured
  if (process.env.HIGGSFIELD_ACCESS_TOKEN) {
    return {
      access_token_encrypted: encrypt(process.env.HIGGSFIELD_ACCESS_TOKEN),
      refresh_token_encrypted: encrypt(""),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year validity
      connected_as: "Environment Token",
      status: "connected",
    };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("agency_settings")
    .select("value")
    .eq("key", "higgsfield_credentials")
    .maybeSingle();

  if (error || !data || !data.value) {
    return null;
  }

  const creds = data.value as HiggsfieldCreds;

  // If there's no refresh token (e.g. manually set token), don't try to refresh
  const decryptedRefreshToken = creds.refresh_token_encrypted ? decrypt(creds.refresh_token_encrypted) : "";
  if (!decryptedRefreshToken) {
    return creds;
  }

  // Check if token needs refresh (expires within 5 minutes)
  const expiresAt = new Date(creds.expires_at).getTime();
  const now = Date.now();
  const buffer = 5 * 60 * 1000; // 5 mins buffer

  if (expiresAt - now < buffer) {
    console.log("🔄 Higgsfield MCP: Access token expired or close to expiry. Refreshing...");
    try {
      const bodyParams = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptedRefreshToken,
        client_id: CLIENT_ID,
      });

      if (CLIENT_SECRET) {
        bodyParams.append("client_secret", CLIENT_SECRET);
      }

      const res = await fetch(HIGGSFIELD_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams,
      });

      if (!res.ok) {
        throw new Error(`Refresh request failed: ${res.statusText}`);
      }

      const tokenData = await res.json();
      const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

      const updatedCreds: HiggsfieldCreds = {
        ...creds,
        access_token_encrypted: encrypt(tokenData.access_token),
        refresh_token_encrypted: encrypt(tokenData.refresh_token || decryptedRefreshToken),
        expires_at: newExpiresAt,
        status: "connected",
        error_message: undefined,
      };

      const { error: saveError } = await supabase
        .from("agency_settings")
        .update({ value: updatedCreds })
        .eq("key", "higgsfield_credentials");

      if (saveError) {
        throw saveError;
      }

      console.log("✅ Higgsfield MCP: Token refreshed successfully.");
      return updatedCreds;
    } catch (refreshError: unknown) {
      const msg = refreshError instanceof Error ? refreshError.message : String(refreshError);
      console.error("❌ Higgsfield MCP Token refresh failed:", msg);
      
      const errorCreds: HiggsfieldCreds = {
        ...creds,
        status: "error",
        error_message: `Token refresh failed: ${msg}`,
      };

      await supabase
        .from("agency_settings")
        .update({ value: errorCreds })
        .eq("key", "higgsfield_credentials");

      return errorCreds;
    }
  }

  return creds;
}

/**
 * Force refresh Higgsfield OAuth access token using refresh token
 */
export async function forceRefreshHiggsfieldToken(creds: HiggsfieldCreds): Promise<HiggsfieldCreds> {
  const decryptedRefreshToken = creds.refresh_token_encrypted ? decrypt(creds.refresh_token_encrypted) : "";
  if (!decryptedRefreshToken) {
    throw new Error("No refresh token available to refresh access token.");
  }

  console.log("🔄 Higgsfield MCP: Force refreshing access token...");
  const bodyParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptedRefreshToken,
    client_id: CLIENT_ID,
  });

  if (CLIENT_SECRET) {
    bodyParams.append("client_secret", CLIENT_SECRET);
  }

  const res = await fetch(HIGGSFIELD_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParams,
  });

  if (!res.ok) {
    throw new Error(`Refresh request failed: ${res.statusText}`);
  }

  const tokenData = await res.json();
  const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

  const updatedCreds: HiggsfieldCreds = {
    ...creds,
    access_token_encrypted: encrypt(tokenData.access_token),
    refresh_token_encrypted: encrypt(tokenData.refresh_token || decryptedRefreshToken),
    expires_at: newExpiresAt,
    status: "connected",
    error_message: undefined,
  };

  const supabase = createServiceRoleClient();
  const { error: saveError } = await supabase
    .from("agency_settings")
    .update({ value: updatedCreds })
    .eq("key", "higgsfield_credentials");

  if (saveError) {
    throw saveError;
  }

  console.log("✅ Higgsfield MCP: Token refreshed successfully.");
  return updatedCreds;
}

/**
 * Establishes a connected Model Context Protocol client to the Higgsfield MCP server
 */
export async function getHiggsfieldMCPClient(creds: HiggsfieldCreds): Promise<{ client: Client; transport: SSEClientTransport }> {
  const decryptedAccessToken = decrypt(creds.access_token_encrypted);

  const client = new Client({
    name: "tbw-os-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  const transport = new SSEClientTransport(
    new URL(HIGGSFIELD_MCP_URL),
    {
      eventSourceInit: {
        headers: {
          Authorization: `Bearer ${decryptedAccessToken}`
        }
      },
      requestInit: {
        headers: {
          Authorization: `Bearer ${decryptedAccessToken}`,
          "Content-Type": "application/json"
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  );

  await client.connect(transport);
  return { client, transport };
}

/**
 * Discovers available models from the Higgsfield MCP tools listing
 */
export async function discoverHiggsfieldModels(creds: HiggsfieldCreds): Promise<string[]> {
  let currentCreds = creds;
  let transport: SSEClientTransport | null = null;
  let toolsResult;

  try {
    const connection = await getHiggsfieldMCPClient(currentCreds);
    transport = connection.transport;
    toolsResult = await connection.client.listTools();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (
      errMsg.includes("401") ||
      errMsg.toLowerCase().includes("unauthorized") ||
      errMsg.includes("Non-200 status code (401)")
    ) {
      console.warn("⚠️ Higgsfield MCP: 401 Unauthorized during discovery. Attempting token refresh...");
      try {
        if (transport) {
          try { await transport.close(); } catch {}
          transport = null;
        }
        currentCreds = await forceRefreshHiggsfieldToken(currentCreds);
        const connection = await getHiggsfieldMCPClient(currentCreds);
        transport = connection.transport;
        toolsResult = await connection.client.listTools();
      } catch (retryErr) {
        console.error("❌ Higgsfield MCP: Token refresh retry failed:", retryErr);
        throw retryErr;
      }
    } else {
      throw err;
    }
  }

  try {
    console.log("⚙️ Higgsfield MCP: Discovered tools:", toolsResult.tools.map(t => t.name));

    // Discover the available image models (nano banana variants)
    const generateTool = toolsResult.tools.find(t => t.name === "generate_image" || t.name === "generate");
    let discoveredModels: string[] = [];

    if (generateTool && generateTool.inputSchema) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schema = generateTool.inputSchema as Record<string, any>;
      const modelProperty = schema.properties?.model;
      if (modelProperty && Array.isArray(modelProperty.enum)) {
        discoveredModels = modelProperty.enum;
      }
    }

    if (discoveredModels.length === 0) {
      discoveredModels = Object.keys(HIGGSFIELD_CONFIG.models);
    }

    // Save discovered models back to config state
    const supabase = createServiceRoleClient();
    const updatedCreds: HiggsfieldCreds = {
      ...currentCreds,
      available_models: discoveredModels,
      status: "connected",
      error_message: undefined
    };

    await supabase
      .from("agency_settings")
      .update({ value: updatedCreds })
      .eq("key", "higgsfield_credentials");

    return discoveredModels;
  } catch (err) {
    console.error("❌ Higgsfield MCP: Failed to parse discovered models:", err);
    return Object.keys(HIGGSFIELD_CONFIG.models);
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch (closeErr) {
        console.warn("Warn closing transport:", closeErr);
      }
    }
  }
}

export function getBaseAppUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital";
  if (
    envUrl.includes("next_public") ||
    envUrl.includes("NEXT_PUBLIC") ||
    envUrl.includes("0.0.0.0") ||
    envUrl.includes("localhost")
  ) {
    return "https://bron.digital";
  }
  return envUrl.trim().replace(/\/+$/, "");
}

export class DBOAuthClientProvider implements OAuthClientProvider {
  get redirectUrl(): string | URL | undefined {
    return `${getBaseAppUrl()}/api/integrations/higgsfield/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    const redirect = `${getBaseAppUrl()}/api/integrations/higgsfield/callback`;
    return {
      redirect_uris: [redirect],
      client_name: "TBW-OS",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid email offline_access",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    try {
      console.log("⚙️ Higgsfield MCP DCR [Stage: clientInformation]: Loading client credentials...");
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("agency_settings")
        .select("value")
        .eq("key", "higgsfield_client_info")
        .maybeSingle();

      if (error) {
        console.error("❌ Higgsfield MCP DCR [Stage: clientInformation]: DB load error:", error);
        return undefined;
      }
      
      if (data?.value) {
        console.log("⚙️ Higgsfield MCP DCR [Stage: clientInformation]: Successfully loaded client credentials:", data.value);
        return data.value as OAuthClientInformationMixed;
      }
      console.log("⚙️ Higgsfield MCP DCR [Stage: clientInformation]: Client not registered yet. Need DCR.");
      return undefined;
    } catch (err) {
      console.error("❌ Higgsfield MCP DCR [Stage: clientInformation]: Failed:", err);
      return undefined;
    }
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    try {
      console.log("⚙️ Higgsfield MCP DCR [Stage: saveClientInformation]: Saving client registration:", clientInformation);
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from("agency_settings")
        .upsert({
          key: "higgsfield_client_info",
          value: clientInformation,
        });

      if (error) {
        throw error;
      }
      console.log("⚙️ Higgsfield MCP DCR [Stage: saveClientInformation]: Saved client registration successfully.");
    } catch (err) {
      console.error("❌ Higgsfield MCP DCR [Stage: saveClientInformation]: Failed to save client registration:", err);
      throw err;
    }
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: tokens]: Loading saved tokens...");
      const creds = await getHiggsfieldCredentials();
      if (creds && creds.status === "connected") {
        const accessToken = decrypt(creds.access_token_encrypted);
        const refreshToken = creds.refresh_token_encrypted ? decrypt(creds.refresh_token_encrypted) : undefined;
        console.log("⚙️ Higgsfield MCP [Stage: tokens]: Loaded saved tokens successfully.");
        return {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
        };
      }
      console.log("⚙️ Higgsfield MCP [Stage: tokens]: No connected tokens found.");
      return undefined;
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: tokens]: Failed to load tokens:", err);
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: saveTokens]: Exchanged authorization code. Saving tokens...");
      const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
      const creds: HiggsfieldCreds = {
        access_token_encrypted: encrypt(tokens.access_token),
        refresh_token_encrypted: encrypt(tokens.refresh_token || ""),
        expires_at: expiresAt,
        connected_as: "Registered Token",
        status: "connected",
      };

      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from("agency_settings")
        .upsert({
          key: "higgsfield_credentials",
          value: creds,
        });

      if (error) {
        throw error;
      }
      console.log("⚙️ Higgsfield MCP [Stage: saveTokens]: Saved tokens successfully.");
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: saveTokens]: Failed to save tokens:", err);
      throw err;
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: saveCodeVerifier]: Saving PKCE verifier...");
      const cookieStore = await cookies();
      cookieStore.set("higgsfield_oauth_verifier", codeVerifier, {
        path: "/",
        maxAge: 300,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      console.log("⚙️ Higgsfield MCP [Stage: saveCodeVerifier]: Saved verifier cookie successfully.");
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: saveCodeVerifier]: Failed:", err);
    }
  }

  async codeVerifier(): Promise<string> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: codeVerifier]: Loading PKCE verifier...");
      const cookieStore = await cookies();
      const val = cookieStore.get("higgsfield_oauth_verifier")?.value || "";
      console.log("⚙️ Higgsfield MCP [Stage: codeVerifier]: Loaded verifier cookie successfully.");
      return val;
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: codeVerifier]: Failed to load verifier:", err);
      return "";
    }
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: saveDiscoveryState]: Saving server discovery metadata:", state.authorizationServerUrl);
      const supabase = createServiceRoleClient();
      const { error } = await supabase
        .from("agency_settings")
        .upsert({
          key: "higgsfield_discovery_state",
          value: state,
        });

      if (error) {
        throw error;
      }
      console.log("⚙️ Higgsfield MCP [Stage: saveDiscoveryState]: Saved discovery state successfully.");
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: saveDiscoveryState]: Failed to save discovery state:", err);
    }
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    try {
      console.log("⚙️ Higgsfield MCP [Stage: discoveryState]: Loading server discovery metadata...");
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("agency_settings")
        .select("value")
        .eq("key", "higgsfield_discovery_state")
        .maybeSingle();

      if (error) {
        console.error("❌ Higgsfield MCP [Stage: discoveryState]: DB load error:", error);
        return undefined;
      }
      
      if (data?.value) {
        console.log("⚙️ Higgsfield MCP [Stage: discoveryState]: Loaded discovery state:", data.value);
        return data.value as OAuthDiscoveryState;
      }
      console.log("⚙️ Higgsfield MCP [Stage: discoveryState]: No cached discovery state found.");
      return undefined;
    } catch (err) {
      console.error("❌ Higgsfield MCP [Stage: discoveryState]: Failed to load discovery state:", err);
      return undefined;
    }
  }

  private authorizationUrl: URL | null = null;
  
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.log("⚙️ Higgsfield MCP [Stage: redirectToAuthorization]: Generated authorization redirect URL:", authorizationUrl.toString());
    this.authorizationUrl = authorizationUrl;
  }

  getAuthorizationUrl(): URL | null {
    return this.authorizationUrl;
  }
}
