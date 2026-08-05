import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, listSocialAccounts, verifyLogin } from "@/lib/recurpost";

export const dynamic = "force-dynamic";

const MAP_KEY = "recurpost_account_map";

// GET — live RecurPost account list + saved account→client mapping.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isRecurPostConfigured()) {
    return NextResponse.json({ success: true, configured: false, accounts: [], mapping: {} });
  }

  const admin = createServiceRoleClient();
  const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", MAP_KEY).maybeSingle();
  const mapping = (mapRow?.value as Record<string, { client_id: string; platform: string }>) || {};

  try {
    const res = await listSocialAccounts();
    // RecurPost shape: { status, message, social_accounts: [{ smpa_id, smpa_name, status }] }
    // The platform lives inside smpa_name, e.g. "Shri jewels [Page] (Facebook Page)".
    const detectPlatform = (label: string): string => {
      const l = label.toLowerCase();
      if (l.includes("instagram")) return "instagram";
      if (l.includes("facebook")) return "facebook";
      if (l.includes("pinterest")) return "pinterest";
      if (l.includes("linkedin")) return "linkedin";
      if (l.includes("youtube")) return "youtube";
      if (l.includes("tiktok")) return "tiktok";
      if (l.includes("google")) return "gbp";
      if (l.includes("threads")) return "threads";
      if (l.includes("bluesky")) return "bluesky";
      if (l.includes("twitter") || l.includes("(x)")) return "twitter";
      return "";
    };
    const raw = (Array.isArray(res) ? res : (res as Record<string, unknown>).social_accounts || (res as Record<string, unknown>).accounts || (res as Record<string, unknown>).data || []) as Array<Record<string, unknown>>;
    const accounts = (Array.isArray(raw) ? raw : [])
      .map((a) => {
        const full = String(a.smpa_name ?? a.name ?? a.account_name ?? "Account");
        const typeLabel = full.match(/\(([^)]+)\)\s*$/)?.[1] || "";
        const display = full.replace(/\s*\[[^\]]*\]/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
        return {
          id: String(a.smpa_id ?? a.id ?? a.account_id ?? ""),
          name: display || full,
          platform: detectPlatform(typeLabel || full),
          typeLabel,
          connected: String(a.status ?? "").toLowerCase() === "connected",
        };
      })
      .filter((a) => a.id);
    return NextResponse.json({ success: true, configured: true, accounts, mapping });
  } catch (err: unknown) {
    return NextResponse.json({ success: true, configured: true, accounts: [], mapping, error: err instanceof Error ? err.message : "Failed to list accounts" });
  }
}

// POST — save mapping { [accountId]: { client_id, platform } } (founder only),
// or { action: "test" } to verify credentials.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") return NextResponse.json({ error: "Founder only" }, { status: 403 });

  const body = await request.json();
  if (body.action === "test") {
    try {
      const res = await verifyLogin();
      return NextResponse.json({ success: true, result: res });
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Verification failed" }, { status: 500 });
    }
  }

  const mapping = body.mapping;
  if (!mapping || typeof mapping !== "object") return NextResponse.json({ error: "mapping object required" }, { status: 400 });
  const admin = createServiceRoleClient();
  await admin.from("agency_settings").upsert({ key: MAP_KEY, value: mapping }, { onConflict: "key" });
  return NextResponse.json({ success: true });
}
