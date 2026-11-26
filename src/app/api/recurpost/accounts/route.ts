import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured, listSocialAccounts, verifyLogin } from "@/lib/recurpost";

export const dynamic = "force-dynamic";

const MAP_KEY = "recurpost_account_map";

type AccountMap = Record<string, { client_id: string; platform: string }>;

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

/**
 * RecurPost's account list, asked for now — never cached, so an account added
 * in RecurPost a moment ago is in the answer.
 * Their shape: { status, message, social_accounts: [{ smpa_id, smpa_name, status }] }.
 */
async function liveAccounts() {
  const res = await listSocialAccounts();
  const raw = (Array.isArray(res) ? res : (res as Record<string, unknown>).social_accounts || (res as Record<string, unknown>).accounts || (res as Record<string, unknown>).data || []) as Array<Record<string, unknown>>;
  return (Array.isArray(raw) ? raw : [])
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
}

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
    const accounts = await liveAccounts();
    return NextResponse.json({ success: true, configured: true, accounts, mapping });
  } catch (err: unknown) {
    return NextResponse.json({ success: true, configured: true, accounts: [], mapping, error: err instanceof Error ? err.message : "Failed to list accounts" });
  }
}

// POST — { action: "connect" | "disconnect", accountId, clientId?, move? } changes
// one account (founder and team); a whole mapping { [accountId]: { client_id,
// platform } } or { action: "test" } stays founder only.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  // Connect or disconnect ONE account — the Manage accounts popup, open to the
  // whole team. It changes a single entry of the saved map on the server, so a
  // page opened an hour ago cannot overwrite what someone else connected since.
  // A client may hold several accounts on one platform; every one gets the post.
  if (body.action === "connect" || body.action === "disconnect") {
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    const admin = createServiceRoleClient();
    const { data: mapRow } = await admin.from("agency_settings").select("value").eq("key", MAP_KEY).maybeSingle();
    const map: AccountMap = { ...((mapRow?.value as AccountMap) || {}) };

    if (body.action === "disconnect") {
      delete map[accountId];
    } else {
      const clientId = typeof body.clientId === "string" ? body.clientId : "";
      if (!clientId) return NextResponse.json({ error: "Pick a client first." }, { status: 400 });
      const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
      if (!client) return NextResponse.json({ error: "That client no longer exists." }, { status: 400 });

      // The account must be one RecurPost lists right now, and its platform is
      // read from RecurPost — an Instagram profile cannot be saved as Facebook.
      let account: Awaited<ReturnType<typeof liveAccounts>>[number] | undefined;
      try {
        account = (await liveAccounts()).find((a) => a.id === accountId);
      } catch (err: unknown) {
        return NextResponse.json({ error: `RecurPost could not be reached (${err instanceof Error ? err.message : "no answer"}) — nothing was changed.` }, { status: 502 });
      }
      if (!account) return NextResponse.json({ error: "RecurPost no longer lists that account — press Refresh." }, { status: 409 });
      const platform = account.platform || (typeof body.platform === "string" ? body.platform : "");
      if (!platform) return NextResponse.json({ error: "Could not tell which platform this account is on." }, { status: 400 });

      // One client's account never moves to another by a stray click: taking
      // it over has to be asked for by name.
      const holder = map[accountId];
      if (holder?.client_id && holder.client_id !== clientId && body.move !== true) {
        const { data: other } = await admin.from("clients").select("name").eq("id", holder.client_id).maybeSingle();
        return NextResponse.json({ error: `This account is connected to ${other?.name || "another client"}.`, usedBy: other?.name || "another client" }, { status: 409 });
      }
      map[accountId] = { client_id: clientId, platform };
    }

    await admin.from("agency_settings").upsert({ key: MAP_KEY, value: map }, { onConflict: "key" });
    return NextResponse.json({ success: true, mapping: map });
  }

  if (role !== "founder") return NextResponse.json({ error: "Founder only" }, { status: 403 });
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

  // The save is the whole map as the BROWSER loaded it — so a page opened
  // before a cleanup and saved after it quietly resurrected every deleted
  // dead id (Swarna Kanchi's YouTube collected four this way). The live
  // account list is the truth: an id RecurPost no longer knows cannot be
  // saved, whatever the page believed.
  let cleaned = mapping as Record<string, unknown>;
  try {
    const live = new Set((await liveAccounts()).map((a) => a.id));
    if (live.size > 0) {
      cleaned = Object.fromEntries(Object.entries(cleaned).filter(([id]) => live.has(id)));
    }
  } catch { /* RecurPost unreachable: save as sent rather than lose the edit */ }

  const admin = createServiceRoleClient();
  await admin.from("agency_settings").upsert({ key: MAP_KEY, value: cleaned }, { onConflict: "key" });
  return NextResponse.json({ success: true });
}
