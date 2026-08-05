import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials } from "@/lib/higgsfield-mcp";
import { getDriveStatus } from "@/lib/google-drive";
import { isRecurPostConfigured } from "@/lib/recurpost";

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

  // RecurPost — the live social posting engine (Social Publisher).
  let rpMode: Mode = "notbuilt";
  let rpDetail = "RECURPOST_EMAIL / RECURPOST_API_KEY not set on the server.";
  if (isRecurPostConfigured()) {
    try {
      const client = createServiceRoleClient();
      const { data: mapRow } = await client.from("agency_settings").select("value").eq("key", "recurpost_account_map").maybeSingle();
      const mapping = (mapRow?.value as Record<string, { client_id?: string }>) || {};
      const mapped = Object.values(mapping).filter((m) => m?.client_id).length;
      if (mapped > 0) {
        rpMode = "live";
        rpDetail = `Connected — ${mapped} social account(s) mapped to clients. Posts go out through RecurPost.`;
      } else {
        rpMode = "configured";
        rpDetail = "Keys set, but no accounts mapped yet — map them in Social Publisher → RecurPost Accounts.";
      }
    } catch (e: unknown) {
      rpMode = "configured";
      rpDetail = e instanceof Error ? e.message : "Could not read the account mapping.";
    }
  }
  connectors.push({ key: "recurpost", name: "RecurPost", category: "Publishing", purpose: "Posting to Instagram, Facebook, Pinterest, LinkedIn & YouTube", mode: rpMode, detail: rpDetail });

  // WhatsApp group reader (Baileys) — feeds the WhatsApp Task Bar.
  let wrMode: Mode = "notbuilt";
  let wrDetail = "Reader has never reported in — start the wa-reader container on the server.";
  try {
    const client = createServiceRoleClient();
    const { data: st } = await client.from("wa_reader_status").select("status, last_seen_at").eq("id", 1).maybeSingle();
    if (st) {
      const fresh = st.last_seen_at && Date.now() - new Date(st.last_seen_at as string).getTime() < 5 * 60 * 1000;
      if (st.status === "connected" && fresh) {
        wrMode = "live";
        wrDetail = "Linked and reading client group messages into the Task Bar.";
      } else if (st.status === "waiting_scan") {
        wrMode = "configured";
        wrDetail = "Running but not linked — scan the QR in Dashboard → WhatsApp Reader.";
      } else {
        wrMode = "offline";
        wrDetail = `Status "${st.status}"${fresh ? "" : " and no heartbeat in the last 5 min"} — check the reader container / re-link.`;
      }
    }
  } catch {
    /* keep notbuilt */
  }
  connectors.push({ key: "wa_reader", name: "WhatsApp Reader", category: "Publishing", purpose: "Reads client group messages into the WhatsApp Task Bar", mode: wrMode, detail: wrDetail });

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
