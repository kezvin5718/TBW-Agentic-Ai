import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

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

  const supabase = await createClient();
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    }
  );

  await client.connect(transport);
  return { client, transport };
}

/**
 * Discovers available models from the Higgsfield MCP tools listing
 */
export async function discoverHiggsfieldModels(creds: HiggsfieldCreds): Promise<string[]> {
  let transport: SSEClientTransport | null = null;
  try {
    const connection = await getHiggsfieldMCPClient(creds);
    const client = connection.client;
    transport = connection.transport;

    // List available tools
    const toolsResult = await client.listTools();
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
      // Fallback if no specific model enum is described in schema
      discoveredModels = Object.keys(HIGGSFIELD_CONFIG.models);
    }

    // Save discovered models back to config state
    const supabase = await createClient();
    const updatedCreds: HiggsfieldCreds = {
      ...creds,
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
    console.error("❌ Higgsfield MCP: Failed to discover models:", err);
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
