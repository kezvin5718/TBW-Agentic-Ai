import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getHiggsfieldCredentials,
  getHiggsfieldGenerationCost,
  uploadToSupabaseStorageDirect,
} from "@/lib/higgsfield-mcp";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import { activeJobs } from "@/lib/higgsfield-state";
import { complete } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";

export const dynamic = "force-dynamic";

type Status = "ok" | "warn" | "fail";
interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
}

function present(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function tag(name: string, v: string | undefined | null): string {
  return `${name}=${present(v) ? "SET" : "MISSING"}`;
}

/**
 * GET /api/diagnostics — Founder-only. Actively probes every major subsystem
 * (Supabase, storage, LLM, Higgsfield connection + live auth, recent generations)
 * and returns a structured result plus a plain-text `report` for copy/paste support.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (user.user_metadata?.role as string) || "client";
  if (role !== "founder") {
    return NextResponse.json({ error: "Forbidden — founder only" }, { status: 403 });
  }

  const checks: Check[] = [];
  const add = (id: string, label: string, status: Status, detail: string) =>
    checks.push({ id, label, status, detail });

  // ---------------------------------------------------------------------------
  // 1. Environment variables (presence only — never expose values)
  // ---------------------------------------------------------------------------
  const supaEnvOk =
    present(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    present(process.env.SUPABASE_SERVICE_ROLE_KEY);
  add(
    "env_supabase",
    "Env: Supabase keys",
    supaEnvOk ? "ok" : "fail",
    [
      tag("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
      tag("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      tag("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    ].join(", ")
  );

  add(
    "env_llm",
    "Env: OpenRouter (LLM)",
    present(process.env.OPENROUTER_API_KEY) ? "ok" : "fail",
    tag("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY) +
      " — if MISSING, all AI text runs in canned mock mode."
  );

  const higgsEnvOk =
    present(process.env.HIGGSFIELD_ACCESS_TOKEN) ||
    (present(process.env.HIGGSFIELD_CLIENT_ID) && present(process.env.HIGGSFIELD_CLIENT_SECRET));
  add(
    "env_higgsfield",
    "Env: Higgsfield",
    higgsEnvOk ? "ok" : "warn",
    [
      tag("HIGGSFIELD_ACCESS_TOKEN", process.env.HIGGSFIELD_ACCESS_TOKEN),
      tag("HIGGSFIELD_CLIENT_ID", process.env.HIGGSFIELD_CLIENT_ID),
      tag("HIGGSFIELD_CLIENT_SECRET", process.env.HIGGSFIELD_CLIENT_SECRET),
    ].join(", ") + " — OAuth connect still works without the static token.",
  );

  add(
    "env_openai",
    "Env: OpenAI (GPT Image / voice)",
    present(process.env.OPENAI_API_KEY) ? "ok" : "warn",
    tag("OPENAI_API_KEY", process.env.OPENAI_API_KEY) +
      " — needed for GPT Image 2 and voice; Nano Banana models do not use it."
  );

  add(
    "env_meta",
    "Env: Meta Ads",
    present(process.env.META_ACCESS_TOKEN) && present(process.env.META_AD_ACCOUNT_ID) ? "ok" : "warn",
    [tag("META_ACCESS_TOKEN", process.env.META_ACCESS_TOKEN), tag("META_AD_ACCOUNT_ID", process.env.META_AD_ACCOUNT_ID)].join(", ")
  );

  add(
    "env_whatsapp",
    "Env: WhatsApp",
    present(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN) &&
      present(process.env.WHATSAPP_PHONE_NUMBER_ID)
      ? "ok"
      : "warn",
    [
      tag("WHATSAPP_ACCESS_TOKEN/WHATSAPP_TOKEN", process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN),
      tag("WHATSAPP_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID),
    ].join(", ")
  );

  add(
    "env_security",
    "Env: Encryption + App URL",
    present(process.env.ENCRYPTION_KEY) ? "ok" : "warn",
    [
      tag("ENCRYPTION_KEY", process.env.ENCRYPTION_KEY) + (present(process.env.ENCRYPTION_KEY) ? "" : " (using insecure built-in fallback!)"),
      `NEXT_PUBLIC_APP_URL=${process.env.NEXT_PUBLIC_APP_URL || "(default bron.digital)"}`,
      `CRON_ENABLED=${process.env.CRON_ENABLED || "false"}`,
    ].join(", ")
  );

  // ---------------------------------------------------------------------------
  // 2. Supabase DB connectivity (service role)
  // ---------------------------------------------------------------------------
  let admin: ReturnType<typeof createServiceRoleClient> | null = null;
  try {
    admin = createServiceRoleClient();
    const { count, error } = await admin.from("clients").select("id", { count: "exact", head: true });
    if (error) throw error;
    add("db", "Supabase database", "ok", `Connected. clients table reachable (count=${count ?? "?"}).`);
  } catch (err: unknown) {
    add("db", "Supabase database", "fail", `Query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Supabase Storage write test (studio-outputs bucket)
  // ---------------------------------------------------------------------------
  try {
    const testUrl = await uploadToSupabaseStorageDirect(
      "diagnostics/healthcheck.txt",
      Buffer.from(`healthcheck ${new Date().toISOString()}`),
      "text/plain"
    );
    if (testUrl) {
      add("storage", "Supabase Storage (studio-outputs)", "ok", `Write OK → ${testUrl}`);
    } else {
      add("storage", "Supabase Storage (studio-outputs)", "fail", "Upload returned null — check bucket exists & service role key. Generated images cannot be saved.");
    }
  } catch (err: unknown) {
    add("storage", "Supabase Storage (studio-outputs)", "fail", `Upload threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // 4. OpenRouter LLM live ping
  // ---------------------------------------------------------------------------
  if (!present(process.env.OPENROUTER_API_KEY)) {
    add("llm_live", "LLM live call", "warn", "OPENROUTER_API_KEY missing → responses are canned mock strings.");
  } else {
    try {
      const started = Date.now();
      const reply = await complete({
        system: "You are a diagnostics probe.",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        model: MODEL_FAST,
        maxTokens: 5,
      });
      const ms = Date.now() - started;
      add("llm_live", "LLM live call", "ok", `Responded in ${ms}ms: "${reply.slice(0, 40).replace(/\n/g, " ")}"`);
    } catch (err: unknown) {
      add("llm_live", "LLM live call", "fail", `Call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Higgsfield connection + credentials
  // ---------------------------------------------------------------------------
  let creds: Awaited<ReturnType<typeof getHiggsfieldCredentials>> = null;
  try {
    creds = await getHiggsfieldCredentials();
    if (!creds) {
      add("higgsfield_conn", "Higgsfield connection", "fail", "Not connected. Go to Integrations → Connect Higgsfield. Image generation will not work.");
    } else if (creds.status === "error") {
      add("higgsfield_conn", "Higgsfield connection", "fail", `Status=error. ${creds.error_message || "Token refresh likely failed — reconnect in Integrations."}`);
    } else {
      const exp = creds.expires_at ? new Date(creds.expires_at) : null;
      const expNote = exp ? `expires ${exp.toISOString()}${exp.getTime() < Date.now() ? " (EXPIRED)" : ""}` : "no expiry";
      add(
        "higgsfield_conn",
        "Higgsfield connection",
        exp && exp.getTime() < Date.now() ? "warn" : "ok",
        `status=${creds.status}, connected_as=${creds.connected_as || "?"}, ${expNote}.`
      );
    }
  } catch (err: unknown) {
    add("higgsfield_conn", "Higgsfield connection", "fail", `Credential load threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // 6. Higgsfield discovered models + resolutions
  // ---------------------------------------------------------------------------
  try {
    const client = admin || createServiceRoleClient();
    const { data: row } = await client
      .from("agency_settings")
      .select("value")
      .eq("key", "higgsfield_credentials")
      .maybeSingle();
    const val = row?.value as { available_models_info?: Array<{ id?: string; resolutions?: string[]; allowed_resolutions?: string[] }> } | null;
    const models = val?.available_models_info || [];
    if (models.length === 0) {
      add("higgsfield_models", "Higgsfield discovered models", "warn", "No models discovered yet. Open Integrations and click Discover/Test. UI falls back to defaults (nano_banana_pro/2 with 1k/2k/4k).");
    } else {
      const summary = models
        .map((m) => `${m.id}: [${(m.resolutions || m.allowed_resolutions || []).join(", ") || "?"}]`)
        .join(" | ");
      const any4k = models.some((m) => (m.resolutions || m.allowed_resolutions || []).map((r) => r.toLowerCase()).includes("4k"));
      add("higgsfield_models", "Higgsfield discovered models", any4k ? "ok" : "warn", `${models.length} model(s). ${summary}${any4k ? "" : " — NOTE: none advertise 4k; live discovery may override the UI's 4k option."}`);
    }
  } catch (err: unknown) {
    add("higgsfield_models", "Higgsfield discovered models", "warn", `Could not read discovered models: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // 7. Higgsfield LIVE auth — cheap cost preflight (no image, exercises token)
  // ---------------------------------------------------------------------------
  if (creds && creds.status !== "error") {
    try {
      const { cost, preflighted } = await getHiggsfieldGenerationCost(creds, HIGGSFIELD_CONFIG.defaultModel, 1);
      if (preflighted) {
        add("higgsfield_live", "Higgsfield live auth (cost preflight)", "ok", `Live MCP call succeeded. ${HIGGSFIELD_CONFIG.defaultModel} = ${cost} credits/image.`);
      } else {
        add("higgsfield_live", "Higgsfield live auth (cost preflight)", "fail", `Live preflight did NOT reach Higgsfield (used fallback cost ${cost}). Token/connection is likely broken → this is why generation stalls with no image. Reconnect in Integrations.`);
      }
    } catch (err: unknown) {
      add("higgsfield_live", "Higgsfield live auth (cost preflight)", "fail", `Live MCP call threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    add("higgsfield_live", "Higgsfield live auth (cost preflight)", "fail", "Skipped — not connected (see Higgsfield connection above).");
  }

  // ---------------------------------------------------------------------------
  // 8. Recent generations + costs
  // ---------------------------------------------------------------------------
  try {
    const client = admin || createServiceRoleClient();
    const { data: gens } = await client
      .from("studio_generations")
      .select("created_at, model, generated_image_url, locally_unrecoverable, is_branded")
      .order("created_at", { ascending: false })
      .limit(5);
    const { data: costs } = await client
      .from("gen_costs")
      .select("created_at, engine, cost, resolution")
      .order("created_at", { ascending: false })
      .limit(5);
    const gRows = gens || [];
    const unrec = gRows.filter((g) => g.locally_unrecoverable).length;
    const gLines = gRows.length
      ? gRows.map((g) => `  - ${g.created_at?.slice(0, 19)} ${g.model} ${g.locally_unrecoverable ? "[LOST FILE]" : g.generated_image_url ? "[stored]" : "[no url]"}`).join("\n")
      : "  (none)";
    const cLines = (costs || []).length
      ? (costs || []).map((c) => `  - ${c.created_at?.slice(0, 19)} ${c.engine} ${c.resolution || "?"} = ${c.cost}cr`).join("\n")
      : "  (none)";
    add(
      "recent",
      "Recent generations & cost log",
      gRows.length === 0 ? "warn" : unrec > 0 ? "warn" : "ok",
      `Last studio_generations (${gRows.length}, ${unrec} lost):\n${gLines}\nLast gen_costs:\n${cLines}`
    );
  } catch (err: unknown) {
    add("recent", "Recent generations & cost log", "warn", `Could not read history: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // 9. In-memory active jobs (stuck-job indicator)
  // ---------------------------------------------------------------------------
  add(
    "active_jobs",
    "In-memory active jobs",
    activeJobs.size > 0 ? "warn" : "ok",
    activeJobs.size > 0
      ? `${activeJobs.size} job(s) currently in memory (still polling or stuck). Keys: ${Array.from(activeJobs.keys()).slice(0, 8).join(", ")}`
      : "0 jobs in memory (idle)."
  );

  // ---------------------------------------------------------------------------
  // Build summary + plain-text report
  // ---------------------------------------------------------------------------
  const summary = {
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  const generatedAt = new Date().toISOString();
  const icon = (s: Status) => (s === "ok" ? "[ OK ]" : s === "warn" ? "[WARN]" : "[FAIL]");
  const report =
    `TBW OS DIAGNOSTICS — ${generatedAt}\n` +
    `Overall: ${summary.ok} ok / ${summary.warn} warn / ${summary.fail} fail\n` +
    `App URL: ${process.env.NEXT_PUBLIC_APP_URL || "(default)"}  |  NODE_ENV=${process.env.NODE_ENV}\n` +
    `${"=".repeat(60)}\n` +
    checks.map((c) => `${icon(c.status)} ${c.label}\n        ${c.detail.replace(/\n/g, "\n        ")}`).join("\n") +
    `\n${"=".repeat(60)}\n`;

  return NextResponse.json({ success: true, generatedAt, summary, checks, report });
}
