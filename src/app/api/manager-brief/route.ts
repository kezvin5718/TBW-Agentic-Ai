import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runManagerBrief } from "@/lib/manager-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

/** GET — the latest manager scan (today's if the cron has run). Console reads this. */
export async function GET() {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("manager_briefs")
    .select("brief_date, notes, brief, created_at")
    .order("brief_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ success: true, latest: data || null });
}

/** POST — run the managers' scan right now (fresh look at live data). */
export async function POST() {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  try {
    const { date, brief } = await runManagerBrief();
    const admin = createServiceRoleClient();
    const { data } = await admin.from("manager_briefs").select("brief_date, notes, brief, created_at").eq("brief_date", date).maybeSingle();
    return NextResponse.json({ success: true, latest: data || { brief_date: date, brief, notes: {} } });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
  }
}
