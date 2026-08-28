import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * PATCH — a member's availability. Body: { id, awayUntil }
 *
 * `awayUntil` is a YYYY-MM-DD date, or null to say they are back.
 *
 * Nothing else about a team member is editable here. Rows are still created in
 * the database by hand — this is the one field the boards have to keep honest,
 * because assigning Friday's work to someone on leave is a mistake nobody
 * notices until Monday.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id, awayUntil } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const value = awayUntil ? String(awayUntil).slice(0, 10) : null;
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return NextResponse.json({ error: "awayUntil must be a YYYY-MM-DD date, or null." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("team_members").update({ away_until: value }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
