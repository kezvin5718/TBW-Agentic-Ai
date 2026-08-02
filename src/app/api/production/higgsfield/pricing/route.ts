import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHiggsfieldCredentials, getHiggsfieldGenerationCost } from "@/lib/higgsfield-mcp";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

export const dynamic = "force-dynamic";

interface PricingRow {
  id: string;
  name: string;
  engine: string;
  costs: Record<string, number | null>; // per resolution; null = not supported
}

// Simple in-process cache — pricing rarely changes, and each refresh makes several
// live MCP cost-preflight calls.
let cache: { at: number; live: boolean; pricing: PricingRow[] } | null = null;
const TTL_MS = 30 * 60 * 1000;

const RESOLUTIONS = ["1k", "2k", "4k"];
const MODELS = [
  { id: "nano_banana_2", name: "Nano Banana 2", engine: "higgsfield", res: ["1k", "2k", "4k"] },
  { id: "nano_banana_pro", name: "Nano Banana Pro", engine: "higgsfield", res: ["1k", "2k", "4k"] },
  { id: "gpt_image_2", name: "GPT Image 2", engine: "openai", res: ["1k"] },
];

function fallbackCost(id: string): number | null {
  const key = id as keyof typeof HIGGSFIELD_CONFIG.modelCosts;
  return HIGGSFIELD_CONFIG.modelCosts[key] ?? null;
}

/**
 * GET /api/production/higgsfield/pricing
 * Returns a per-model × per-resolution credit price table for image generation.
 * Uses Higgsfield's real cost preflight (get_cost) for the Nano Banana models when
 * connected; GPT Image 2 is a fixed OpenAI price. Falls back to configured costs
 * when disconnected. Cached for 30 minutes.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ success: true, live: cache.live, pricing: cache.pricing, cached: true });
  }

  const creds = await getHiggsfieldCredentials();
  const connected = !!creds && creds.status !== "error";
  let anyLive = false;

  const table: Record<string, Record<string, number | null>> = {};
  MODELS.forEach((m) => (table[m.id] = {}));

  const tasks: Promise<void>[] = [];
  for (const m of MODELS) {
    for (const res of RESOLUTIONS) {
      if (!m.res.includes(res)) {
        table[m.id][res] = null;
        continue;
      }
      if (m.engine === "openai" || !connected) {
        table[m.id][res] = fallbackCost(m.id);
        continue;
      }
      tasks.push(
        (async () => {
          try {
            const { cost, preflighted } = await getHiggsfieldGenerationCost(creds, m.id, 1, { resolution: res });
            table[m.id][res] = cost;
            if (preflighted) anyLive = true;
          } catch {
            table[m.id][res] = fallbackCost(m.id);
          }
        })()
      );
    }
  }
  await Promise.all(tasks);

  const pricing: PricingRow[] = MODELS.map((m) => ({ id: m.id, name: m.name, engine: m.engine, costs: table[m.id] }));
  cache = { at: now, live: anyLive, pricing };

  return NextResponse.json({ success: true, live: anyLive, pricing, cached: false });
}
