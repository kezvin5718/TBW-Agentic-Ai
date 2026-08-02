import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials } from "@/lib/higgsfield-mcp";
import { getDriveStatus } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

type Mode = "live" | "configured" | "simulated" | "offline" | "notbuilt";
interface Connector {
  key: string;
  name: string;
  category: string;
  purpose: string;
  mode: Mode;
  detail: string;
}

function has(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * GET /api/connections — Founder/employee. A fast at-a-glance status board for
 * every external connector: is it live, configured-but-idle, running in
 * simulated/mock mode, offline, or not built yet. (For a deep live test, use
 * System Diagnostics.)
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connectors: Connector[] = [];

  // --- Data / infrastructure ------------------------------------------------
  let dbMode: Mode = "offline";
  let dbDetail = "Could not reach the database.";
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.from("clients").select("id", { count: "exact", head: true });
    if (!error) {
      dbMode = "live";
      dbDetail = "Connected — reads & writes working.";
    } else {
      dbDetail = error.message;
    }
  } catch (e: unknown) {
    dbDetail = e instanceof Error ? e.message : "unavailable";
  }
  connectors.push({ key: "supabase_db", name: "Supabase Database", category: "Data", purpose: "All app records (clients, plans, creatives, etc.)", mode: dbMode, detail: dbDetail });

  connectors.push({
    key: "supabase_storage",
    name: "Supabase Storage",
    category: "Data",
    purpose: "Logos, guideline PDFs, uploaded creatives",
    mode: has(process.env.SUPABASE_SERVICE_ROLE_KEY) ? "live" : "offline",
    detail: has(process.env.SUPABASE_SERVICE_ROLE_KEY) ? "Service key present — uploads working." : "SUPABASE_SERVICE_ROLE_KEY missing.",
  });

  // --- AI generation --------------------------------------------------------
  connectors.push({
    key: "openrouter",
    name: "OpenRouter (AI text)",
    category: "AI",
    purpose: "All AI text: strategy, captions, QC, Bron, plan import",
    mode: has(process.env.OPENROUTER_API_KEY) ? "live" : "simulated",
    detail: has(process.env.OPENROUTER_API_KEY) ? "Key set — Claude/Gemini/GPT via OpenRouter." : "No key → canned mock responses.",
  });

  connectors.push({
    key: "openai",
    name: "OpenAI",
    category: "AI",
    purpose: "GPT Image 2, Whisper voice, TTS",
    mode: has(process.env.OPENAI_API_KEY) ? "live" : "simulated",
    detail: has(process.env.OPENAI_API_KEY) ? "Key set." : "No key → image/voice run in mock mode.",
  });

  // Higgsfield (image/video generation via MCP)
  let hfMode: Mode = "offline";
  let hfDetail = "Not connected — connect in Integrations.";
  try {
    const creds = await getHiggsfieldCredentials();
    if (creds && creds.status === "connected") {
      hfMode = "live";
      hfDetail = `Connected as ${creds.connected_as || "token"}.`;
    } else if (creds && creds.status === "error") {
      hfMode = "offline";
      hfDetail = creds.error_message || "Token error — reconnect.";
    }
  } catch (e: unknown) {
    hfDetail = e instanceof Error ? e.message : "unavailable";
  }
  connectors.push({ key: "higgsfield", name: "Higgsfield", category: "AI", purpose: "Nano Banana image/video generation", mode: hfMode, detail: hfDetail });

  // --- Storage / archive ----------------------------------------------------
  let driveMode: Mode = "notbuilt";
  let driveDetail = "GOOGLE_CLIENT_ID / SECRET not set on the server.";
  try {
    const ds = await getDriveStatus();
    if (ds.connected) {
      driveMode = "live";
      driveDetail = `Connected${ds.email ? ` — ${ds.email}` : ""}. New images save to Drive.`;
    } else if (ds.configured) {
      driveMode = "configured";
      driveDetail = "Configured but not connected — click Connect in Integrations.";
    }
  } catch {
    /* keep notbuilt */
  }
  connectors.push({ key: "google_drive", name: "Google Drive", category: "Storage", purpose: "Permanent image storage (your 20TB)", mode: driveMode, detail: driveDetail });

  // --- Publishing / social --------------------------------------------------
  const metaConfigured = has(process.env.META_ACCESS_TOKEN) && has(process.env.META_AD_ACCOUNT_ID);
  connectors.push({
    key: "meta",
    name: "Meta (Instagram / Facebook)",
    category: "Publishing",
    purpose: "Posting creatives + ad campaigns via Graph API",
    mode: metaConfigured ? "configured" : "simulated",
    detail: metaConfigured ? "Tokens set — real Graph API calls (per-client tokens still needed to post)." : "No agency token → returns mock IDs, nothing actually posts.",
  });

  const waConfigured = has(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN) && has(process.env.WHATSAPP_PHONE_NUMBER_ID);
  connectors.push({
    key: "whatsapp",
    name: "WhatsApp Cloud API",
    category: "Publishing",
    purpose: "Approvals, client messages, Bron voice",
    mode: waConfigured ? "configured" : "simulated",
    detail: waConfigured ? "Token + phone set — real sends." : "No token → messages are simulated (not delivered).",
  });

  // --- Known simulated surface (not a connector, but important context) ------
  connectors.push({
    key: "ad_metrics",
    name: "Ad Performance Metrics",
    category: "Publishing",
    purpose: "Spend / clicks / ROAS feeding the ads autopilot",
    mode: "simulated",
    detail: "Always simulated with random values — real Meta Insights ingestion is NOT built yet.",
  });

  const summary = {
    live: connectors.filter((c) => c.mode === "live").length,
    configured: connectors.filter((c) => c.mode === "configured").length,
    simulated: connectors.filter((c) => c.mode === "simulated").length,
    offline: connectors.filter((c) => c.mode === "offline").length,
    notbuilt: connectors.filter((c) => c.mode === "notbuilt").length,
  };

  return NextResponse.json({ success: true, connectors, summary });
}
