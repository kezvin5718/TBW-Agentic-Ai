import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTIONS = ["snooze", "accept", "reopen"];
/** What "I'm on it" buys you before the managers raise it again. */
const DEFAULT_SNOOZE_DAYS = 3;

// The managers' ledger is the founder's own list of what he has decided to
// live with. Nobody else edits it.
async function requireFounder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (role !== "founder") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** GET — everything still live: what is open, and what is snoozed but coming back. */
export async function GET() {
  const guard = await requireFounder();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("manager_issues")
    .select("key, manager, title, metric, status, first_seen, last_seen, snooze_until, times_seen")
    .in("status", ["open", "snoozed"])
    .order("manager", { ascending: true })
    // Oldest first: the thing that has been asked for longest is asked first.
    .order("first_seen", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, issues: data || [], today: istToday() });
}

/**
 * PATCH — the founder's two buttons, and the way back. Body: { key, action, days? }
 *
 * Snoozing says "I know, I'm on it"; accepting says "this is the cost of doing
 * business" and is remembered with the size it was accepted at, so the scan can
 * raise it again if it doubles.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireFounder();
  if (guard.error) return guard.error;

  const { key, action, days } = await request.json().catch(() => ({}));
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (!ACTIONS.includes(String(action))) {
    return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(", ")}` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("manager_issues").select("key, metric").eq("key", key).maybeSingle();
  if (!row) return NextResponse.json({ error: "That issue is no longer on the ledger." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (action === "snooze") {
    const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.min(Math.round(Number(days)), 90) : DEFAULT_SNOOZE_DAYS;
    const until = new Date(Date.now() + span * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    Object.assign(patch, { status: "snoozed", snooze_until: until, fixed_at: null });
  } else if (action === "accept") {
    Object.assign(patch, { status: "accepted", accepted_metric: row.metric, snooze_until: null, fixed_at: null });
  } else {
    Object.assign(patch, { status: "open", snooze_until: null, accepted_metric: null, fixed_at: null });
  }

  const { error } = await admin.from("manager_issues").update(patch).eq("key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
