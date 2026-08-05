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
    // Response shape can vary — normalise into an array of accounts.
    const raw = (Array.isArray(res) ? res : (res as Record<string, unknown>).accounts || (res as Record<string, unknown>).data || (res as Record<string, unknown>).social_accounts || []) as Array<Record<string, unknown>>;
    const accounts = (Array.isArray(raw) ? raw : []).map((a) => ({
      id: String(a.id ?? a.account_id ?? ""),
      name: String(a.name ?? a.account_name ?? a.username ?? a.title ?? "Account"),
      platform: String(a.social_media ?? a.platform ?? a.type ?? a.account_type ?? "").toLowerCase(),
      raw: a,
    }));
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
