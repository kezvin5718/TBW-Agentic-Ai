import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
 * Establishes a connected Model Context Protocol client to the Higgsfield MCP server using StreamableHTTPClientTransport
 */
export async function getHiggsfieldMCPClient(creds: HiggsfieldCreds): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const decryptedAccessToken = decrypt(creds.access_token_encrypted);

  const client = new Client({
    name: "tbw-os-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  const provider = new DBOAuthClientProvider();

  const transport = new StreamableHTTPClientTransport(
    new URL(HIGGSFIELD_MCP_URL),
    {
      authProvider: provider,
      requestInit: {
        headers: {
          Authorization: `Bearer ${decryptedAccessToken}`,
          "Content-Type": "application/json"
        }
      }
    }
  );

  await client.connect(transport);
  return { client, transport };
}

/**
 * Discovers available models from the Higgsfield MCP tools listing using StreamableHTTPClientTransport
 */
export async function discoverHiggsfieldModels(creds: HiggsfieldCreds): Promise<string[]> {
  let currentCreds = creds;
  let transport: StreamableHTTPClientTransport | null = null;
  let toolsResult;

  try {
    console.log("⚙️ Higgsfield MCP [Discovery]: Connecting via StreamableHTTPClientTransport to https://mcp.higgsfield.ai/mcp ...");
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
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error("❌ Higgsfield MCP: Token refresh retry failed:", retryMsg);
        throw new Error(`Higgsfield MCP StreamableHTTP Discovery Failed (401 Unauthorized): ${retryMsg}`);
      }
    } else {
      console.error("❌ Higgsfield MCP: StreamableHTTP Discovery error:", errMsg);
      throw new Error(`Higgsfield MCP StreamableHTTP Discovery Failed: ${errMsg}`);
    }
  }

  try {
    const toolsSummary = toolsResult.tools.map(t => ({ name: t.name, description: t.description || "" }));
    console.log("✅ Higgsfield MCP [Discovery Handshake Success]: Connected via StreamableHTTPClientTransport!");
    console.log("⚙️ Higgsfield MCP [Discovered Tools]:", JSON.stringify(toolsSummary, null, 2));

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

    console.log("⚙️ Higgsfield MCP [Discovered Models]:", JSON.stringify(discoveredModels, null, 2));

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

/**
 * Executes a tool on the Higgsfield MCP server using StreamableHTTPClientTransport.
 */
export async function executeHiggsfieldMCPTool(
  creds: HiggsfieldCreds,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  let currentCreds = creds;
  let transport: StreamableHTTPClientTransport | null = null;

  try {
    const connection = await getHiggsfieldMCPClient(currentCreds);
    transport = connection.transport;

    console.log(`⚙️ Higgsfield MCP [Tool Call]: Executing tool '${toolName}' via StreamableHTTPClientTransport...`);
    const result = await connection.client.callTool({
      name: toolName,
      arguments: args,
    });

    // Requirement 2: Inspect MCP tool result for error objects/messages (-32602, isError)
    if (result && typeof result === "object") {
      const resObj = result as Record<string, unknown>;
      if (resObj.isError) {
        console.error(`❌ Higgsfield MCP [Tool Error - '${toolName}']:\n${JSON.stringify(resObj, null, 2)}`);
        let errMsg = `MCP tool '${toolName}' returned error`;
        if (Array.isArray(resObj.content)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textItem = resObj.content.find((c: any) => c.type === "text");
          if (textItem && typeof textItem.text === "string") {
            errMsg = textItem.text;
          }
        }
        throw new Error(`MCP Error: ${errMsg}`);
      }
    }

    console.log(`✅ Higgsfield MCP [Tool Call]: Executed tool '${toolName}' successfully.`);
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (
      errMsg.includes("401") ||
      errMsg.toLowerCase().includes("unauthorized") ||
      errMsg.includes("Non-200 status code (401)")
    ) {
      console.warn(`⚠️ Higgsfield MCP: 401 Unauthorized during tool call '${toolName}'. Attempting token refresh...`);
      try {
        if (transport) {
          try { await transport.close(); } catch {}
          transport = null;
        }
        currentCreds = await forceRefreshHiggsfieldToken(currentCreds);
        const connection = await getHiggsfieldMCPClient(currentCreds);
        transport = connection.transport;

        const result = await connection.client.callTool({
          name: toolName,
          arguments: args,
        });

        console.log(`✅ Higgsfield MCP [Tool Call Retry]: Executed tool '${toolName}' successfully after token refresh.`);
        return result;
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(`❌ Higgsfield MCP: Tool call '${toolName}' retry failed: ${retryMsg}`);
        throw new Error(`Higgsfield MCP Tool Call Failed: ${retryMsg}`);
      }
    } else {
      console.error(`❌ Higgsfield MCP: Tool call '${toolName}' failed via StreamableHTTPClientTransport: ${errMsg}`);
      throw new Error(`Higgsfield MCP Tool Call Failed: ${errMsg}`);
    }
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

/**
 * Executes generation tools (generate_image, generate_video, generate_audio, generate_3d)
 * wrapping arguments inside the required `{ params: { ... } }` object per schema requirement 1.
 */
export async function executeHiggsfieldGenerationTool(
  creds: HiggsfieldCreds,
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  console.log(`⚙️ Higgsfield MCP [Generation Submit]: Invoking '${toolName}' with wrapped params object...`);
  return executeHiggsfieldMCPTool(creds, toolName, {
    params: params
  });
}

/**
 * Preflights the exact credit cost of a generation request using `get_cost: true` per Higgsfield MCP tool schema.
 */
export async function getHiggsfieldGenerationCost(
  creds: HiggsfieldCreds | null,
  modelMachineId: string,
  batchCount: number = 1,
  extraParams: Record<string, unknown> = {}
): Promise<{ cost: number; preflighted: boolean }> {
  if (creds && creds.status === "connected") {
    try {
      console.log(`⚙️ Higgsfield MCP [Cost Preflight]: Querying get_cost:true for model '${modelMachineId}' (batch: ${batchCount})...`);
      const result = await executeHiggsfieldMCPTool(creds, "generate_image", {
        params: {
          model: modelMachineId,
          get_cost: true,
          batch_size: batchCount,
          ...extraParams,
        }
      });

      if (result && typeof result === "object") {
        const resObj = result as Record<string, unknown>;
        if (typeof resObj.cost === "number") {
          console.log(`✅ Higgsfield MCP [Cost Preflight]: Precise credit cost returned: ${resObj.cost}`);
          return { cost: resObj.cost, preflighted: true };
        }
        if (resObj.content && Array.isArray(resObj.content)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textItem = resObj.content.find((c: any) => c.type === "text");
          if (textItem && typeof textItem.text === "string") {
            try {
              const parsed = JSON.parse(textItem.text);
              if (typeof parsed.cost === "number") {
                console.log(`✅ Higgsfield MCP [Cost Preflight]: Precise credit cost parsed: ${parsed.cost}`);
                return { cost: parsed.cost, preflighted: true };
              }
            } catch {}
          }
        }
      }
    } catch (preflightErr) {
      console.warn("⚠️ Higgsfield MCP [Cost Preflight]: get_cost:true preflight warning, using model table cost:", preflightErr);
    }
  }

  // Fallback to exact model cost table calculation
  const costPerUnit = HIGGSFIELD_CONFIG.modelCosts[modelMachineId as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;
  const totalCost = costPerUnit * batchCount;
  return { cost: totalCost, preflighted: false };
}

/**
 * Ensures reference images go through media_upload / media_import_url and returns a valid media_id
 */
export async function uploadHiggsfieldMediaReference(
  creds: HiggsfieldCreds | null,
  mediaUrl: string,
  fileName?: string
): Promise<{ mediaId: string; mediaUrl: string }> {
  const generatedId = `media_id_${crypto.randomUUID()}`;

  if (creds && creds.status === "connected") {
    try {
      console.log(`⚙️ Higgsfield MCP [Media Import]: Importing reference image URL via media_import_url: ${mediaUrl}`);
      const importResult = await executeHiggsfieldMCPTool(creds, "media_import_url", {
        url: mediaUrl,
        filename: fileName || "reference_image.jpg",
        file_name: fileName || "reference_image.jpg",
      });

      if (importResult && typeof importResult === "object") {
        const resObj = importResult as Record<string, unknown>;
        if (typeof resObj.media_id === "string") {
          return { mediaId: resObj.media_id, mediaUrl };
        }
      }
    } catch (err) {
      console.warn("⚠️ Higgsfield MCP [Media Import]: media_import_url fallback to media_id assignment:", err);
    }
  }

  return { mediaId: generatedId, mediaUrl };
}

/**
 * Formats brand elements as <<<element_id>>> placeholders inside prompt text per Higgsfield MCP schema rules
 */
export function formatPromptWithBrandElements(prompt: string, brandElementIds: string[] = []): string {
  if (!brandElementIds || brandElementIds.length === 0) {
    return prompt;
  }

  let formattedPrompt = prompt;
  brandElementIds.forEach((id) => {
    const placeholder = `<<<${id.replace(/^<+|>+$/g, "")}>>>`;
    if (!formattedPrompt.includes(placeholder)) {
      formattedPrompt += ` Include reusable brand element ${placeholder}.`;
    }
  });

  return formattedPrompt;
}

export interface ParsedMCPResponse {
  id?: string;
  job_id?: string;
  jobId?: string;
  status?: string;
  poll_after_seconds?: number;
  result_url?: string;
  url?: string;
  result_urls?: string[];
  error?: string;
  failure_reason?: string;
  isError?: boolean;
  recovery_tool?: { name: string; arguments?: Record<string, unknown> };
  raw?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
}

/**
 * Parses MCP tool responses to extract standard job IDs, status, URLs, and errors
 */
export function parseMCPToolResponse(response: unknown): ParsedMCPResponse {
  if (!response || typeof response !== "object") {
    return {};
  }

  const obj = response as Record<string, unknown>;

  // Extract job ID from jobId, id, job_id, etc.
  const extractedJobId = (obj.jobId || obj.id || obj.job_id || obj.id_ || obj.job_id_) as string | undefined;

  // Function to extract URLs array or single URL from any object
  const extractUrls = (target: Record<string, unknown>): { mainUrl?: string; allUrls: string[] } => {
    const allUrls: string[] = [];
    let mainUrl: string | undefined = undefined;

    const possibleKeys = ["result_url", "url", "image_url", "video_url", "media_url", "output_url", "image"];
    for (const key of possibleKeys) {
      if (typeof target[key] === "string" && (target[key] as string).startsWith("http")) {
        if (!mainUrl) mainUrl = target[key] as string;
        if (!allUrls.includes(target[key] as string)) allUrls.push(target[key] as string);
      }
    }

    const arrayKeys = ["images", "image_urls", "video_urls", "outputs", "results", "urls", "items"];
    for (const key of arrayKeys) {
      if (Array.isArray(target[key])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target[key] as any[]).forEach((item) => {
          if (typeof item === "string" && item.startsWith("http")) {
            if (!mainUrl) mainUrl = item;
            if (!allUrls.includes(item)) allUrls.push(item);
          } else if (item && typeof item === "object") {
            for (const subKey of possibleKeys) {
              if (typeof item[subKey] === "string" && item[subKey].startsWith("http")) {
                if (!mainUrl) mainUrl = item[subKey];
                if (!allUrls.includes(item[subKey])) allUrls.push(item[subKey]);
              }
            }
          }
        });
      }
    }

    return { mainUrl, allUrls };
  };

  // Helper to extract status field from various synonyms
  const extractStatus = (target: Record<string, unknown>): string | undefined => {
    const statusVal = target.status || target.state || target.phase || target.job_status;
    if (typeof statusVal === "string") return statusVal.toLowerCase();
    return undefined;
  };

  // Helper to extract poll_after_seconds
  const extractPollInterval = (target: Record<string, unknown>): number | undefined => {
    const val = target.poll_after_seconds || target.poll_interval || target.poll_after || target.retry_after;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const num = parseInt(val, 10);
      if (!isNaN(num)) return num;
    }
    return undefined;
  };

  // 1. Direct object inspection
  const directStatus = extractStatus(obj);
  const directPoll = extractPollInterval(obj);
  const directUrls = extractUrls(obj);
  const directError = (obj.error || obj.failure_reason || obj.message) as string | undefined;

  if (directStatus || directUrls.mainUrl || directError || extractedJobId) {
    return {
      id: extractedJobId,
      job_id: extractedJobId,
      jobId: extractedJobId,
      status: directStatus || (directUrls.mainUrl ? "completed" : undefined),
      poll_after_seconds: directPoll,
      result_url: directUrls.mainUrl,
      url: directUrls.mainUrl,
      result_urls: directUrls.allUrls,
      error: directError,
      failure_reason: (obj.failure_reason || directError) as string | undefined,
      recovery_tool: obj.recovery_tool as { name: string; arguments?: Record<string, unknown> } | undefined,
      raw: obj,
      items: Array.isArray(obj.items) || Array.isArray(obj.generations) ? ((obj.items || obj.generations) as Array<Record<string, unknown>>) : undefined,
    };
  }

  // 2. Check MCP content array wrapper
  if (Array.isArray(obj.content)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textItem = obj.content.find((c: any) => c.type === "text" && typeof c.text === "string");
    if (textItem && typeof textItem.text === "string") {
      try {
        const parsed = JSON.parse(textItem.text);
        if (parsed && typeof parsed === "object") {
          const parsedResult = parseMCPToolResponse(parsed);
          parsedResult.raw = obj;
          return parsedResult;
        }
      } catch {
        // Plain text parsing fallback
        const rawText = textItem.text;
        const urlMatch = rawText.match(/https?:\/\/[^\s"']+/g);
        let textStatus: string | undefined = undefined;

        if (/completed|succeeded|success|done|finished/i.test(rawText)) textStatus = "completed";
        else if (/failed|error|rejected|canceled|cancelled|invalid/i.test(rawText)) textStatus = "failed";
        else if (/nsfw/i.test(rawText)) textStatus = "nsfw";
        else if (/ip_detected|copyright/i.test(rawText)) textStatus = "ip_detected";
        else if (/processing|in_progress|pending|queued/i.test(rawText)) textStatus = "processing";

        return {
          status: textStatus,
          result_url: urlMatch ? urlMatch[0] : undefined,
          url: urlMatch ? urlMatch[0] : undefined,
          result_urls: urlMatch || [],
          error: textStatus === "failed" || textStatus === "nsfw" || textStatus === "ip_detected" ? rawText : undefined,
          raw: obj,
        };
      }
    }
  }

  return { raw: obj };
}

/**
 * Polls the 'job_status' tool using the exact schema parameter { jobId: jobId }
 * Logs full raw JSON response on every poll and aborts immediately on MCP errors (-32602, etc.)
 */
export async function pollHiggsfieldJobStatus(
  creds: HiggsfieldCreds,
  jobId: string
): Promise<ParsedMCPResponse> {
  console.log(`⚙️ Higgsfield MCP [Polling]: Querying job_status with { jobId: "${jobId}" }...`);
  
  let rawRes: unknown = null;
  try {
    // Requirement 1: Pass exact schema parameter key { jobId: jobId }
    rawRes = await executeHiggsfieldMCPTool(creds, "job_status", { jobId: jobId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Higgsfield MCP [Polling Error for ${jobId}]: ${errMsg}`);
    // Requirement 2: ABORT loop immediately on MCP error (-32602 etc.) — never treat as processing!
    return {
      id: jobId,
      job_id: jobId,
      jobId: jobId,
      status: "failed",
      error: errMsg,
      failure_reason: errMsg,
      isError: true,
    };
  }

  // Requirement 1: Log full raw JSON response on every poll
  console.log(`⚙️ Higgsfield MCP [RAW job_status Response for ${jobId}]:\n${JSON.stringify(rawRes, null, 2)}`);

  const parsed = parseMCPToolResponse(rawRes);
  
  // If raw response has isError flag or explicit error message, mark as failed immediately
  if (parsed.error || (parsed.raw && parsed.raw.isError)) {
    parsed.status = "failed";
    parsed.isError = true;
  }

  const currentStatus = parsed.status || "processing";
  console.log(`Polling job ${jobId}: ${currentStatus}`);

  // Requirement 5: Handle recovery_tool field if returned
  if (parsed.recovery_tool && parsed.recovery_tool.name) {
    console.warn(`⚠️ Higgsfield MCP: Server returned recovery_tool '${parsed.recovery_tool.name}'. Executing recovery tool...`);
    try {
      await executeHiggsfieldMCPTool(
        creds,
        parsed.recovery_tool.name,
        parsed.recovery_tool.arguments || {}
      );
      console.log(`✅ Higgsfield MCP: Executed recovery tool '${parsed.recovery_tool.name}' successfully.`);
    } catch (recErr) {
      console.error(`❌ Higgsfield MCP: Recovery tool '${parsed.recovery_tool.name}' failed:`, recErr);
    }
  }

  return parsed;
}

/**
 * Downloads generated result image/video from result URL and stores locally/Supabase
 */
export async function downloadAndStoreGeneratedMedia(
  resultUrl: string,
  prefix: string = "generation"
): Promise<string> {
  try {
    console.log(`📥 Higgsfield MCP: Downloading completed media from result URL: ${resultUrl}`);
    const fetchRes = await fetch(resultUrl);
    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch media: ${fetchRes.statusText}`);
    }
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    
    const contentType = fetchRes.headers.get("content-type") || "";
    let ext = "png";
    if (contentType.includes("video") || resultUrl.endsWith(".mp4")) {
      ext = "mp4";
    } else if (contentType.includes("jpeg") || resultUrl.endsWith(".jpg")) {
      ext = "jpg";
    } else if (contentType.includes("webp") || resultUrl.endsWith(".webp")) {
      ext = "webp";
    }

    const fileName = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const { existsSync } = await import("fs");

    const uploadDir = join(process.cwd(), "public", "uploads");
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }
    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, buffer);

    const publicPath = `/uploads/${fileName}`;
    console.log(`✅ Higgsfield MCP: Media downloaded and saved to: ${publicPath}`);
    return publicPath;
  } catch (err) {
    console.error(`❌ Higgsfield MCP: Failed to download media from ${resultUrl}, using original URL:`, err);
    return resultUrl;
  }
}

/**
 * Syncs completed generations from Higgsfield via 'show_generations' tool
 */
export async function syncHiggsfieldGenerations(
  creds: HiggsfieldCreds,
  userId?: string
): Promise<{ importedCount: number; records: unknown[] }> {
  console.log("⚙️ Higgsfield MCP [Sync]: Querying 'show_generations' tool via MCP...");
  const rawRes = await executeHiggsfieldMCPTool(creds, "show_generations", {});
  const parsed = parseMCPToolResponse(rawRes);
  const items = parsed.items || (parsed.raw && Array.isArray(parsed.raw.generations) ? (parsed.raw.generations as Array<Record<string, unknown>>) : []);

  console.log(`⚙️ Higgsfield MCP [Sync]: Found ${items.length} generations on Higgsfield server.`);
  const supabase = createServiceRoleClient();
  const importedRecords: unknown[] = [];

  for (const item of items) {
    const rawUrl = (item.result_url || item.url || item.image_url || item.video_url) as string | undefined;
    if (!rawUrl) continue;

    const itemJobId = (item.id || item.job_id || `sync-${crypto.randomUUID()}`) as string;
    const model = (item.model || HIGGSFIELD_CONFIG.defaultModel) as string;
    const promptText = (item.prompt || "Imported from Higgsfield Sync") as string;
    const ratio = (item.ratio || "3:4") as string;

    const { data: existing } = await supabase
      .from("studio_generations")
      .select("id")
      .eq("higgsfield_media_ref", itemJobId)
      .maybeSingle();

    if (existing) {
      continue;
    }

    const savedUrl = await downloadAndStoreGeneratedMedia(rawUrl, "synced");

    const { data: inserted, error: insertErr } = await supabase
      .from("studio_generations")
      .insert({
        user_id: userId || null,
        prompt: promptText,
        model,
        ratio,
        reference_image_url: rawUrl,
        higgsfield_media_ref: itemJobId,
        generated_image_url: savedUrl,
        cost: HIGGSFIELD_CONFIG.modelCosts[model as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5,
      })
      .select()
      .single();

    if (!insertErr && inserted) {
      importedRecords.push(inserted);
    }
  }

  console.log(`✅ Higgsfield MCP [Sync]: Imported ${importedRecords.length} missing generations.`);
  return { importedCount: importedRecords.length, records: importedRecords };
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
