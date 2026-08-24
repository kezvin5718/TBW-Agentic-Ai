import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The stages a festival creative moves through. Approved is the end of it. */
const STATUSES = ["todo", "review", "approved"];

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * One row per client per festival — the list the team works through when Diwali
 * is coming and every brand needs its own creative.
 *
 * The festival is the same one Campaign Planning names, so the two never drift;
 * what lives here is only who is doing which brand, and what its line says.
 */

/** GET ?festivalId= — every client on this festival, unfinished first. */
export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const festivalId = new URL(request.url).searchParams.get("festivalId");
  if (!festivalId) return NextResponse.json({ error: "festivalId required" }, { status: 400 });

  const admin = createServiceRoleClient();
  // Descending status happens to read todo → review → approved, so the
  // outstanding work arrives first even before the board arranges it. Ordering
  // by the client's name belongs to the embedded table and cannot order these
  // rows, so the board sorts by name itself.
  const { data, error } = await admin
    .from("festival_tasks")
    .select("*, clients(name)")
    .eq("festival_id", festivalId)
    .order("status", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, tasks: data || [] });
}

/**
 * POST — put clients on a festival. Body: { festivalId, clientIds: [] }
 *
 * Adding the same client twice is a thing people do; the unique pair means the
 * second attempt is simply ignored rather than being an error to explain.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { festivalId, clientIds } = await request.json();
  const ids = (Array.isArray(clientIds) ? clientIds : []).filter((c): c is string => typeof c === "string" && !!c);
  if (!festivalId) return NextResponse.json({ error: "festivalId required" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "Pick at least one client." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("festival_tasks")
    .upsert(
      ids.map((clientId) => ({ festival_id: festivalId, client_id: clientId, status: "todo" })),
      { onConflict: "festival_id,client_id", ignoreDuplicates: true }
    )
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const added = (data || []).length;
  return NextResponse.json({
    success: true,
    added,
    message: added === 0
      ? "Those clients were already on this festival."
      : `${added} client${added === 1 ? "" : "s"} added.`,
  });
}

/** PATCH — edit one row. Body: { id, tagline?, teamMemberId?, assigneeName?, status? } */
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id, tagline, teamMemberId, assigneeName, status } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (tagline !== undefined) patch.tagline = String(tagline || "").trim().slice(0, 300) || null;
  if (teamMemberId !== undefined) patch.team_member_id = teamMemberId || null;
  if (assigneeName !== undefined) patch.assignee_name = String(assigneeName || "").trim().slice(0, 120) || null;
  if (status !== undefined) {
    if (!STATUSES.includes(String(status))) {
      return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
    }
    // Approving stamps the hour it was approved; moving back down the stages
    // takes the stamp away again, so "completed_at" never describes a creative
    // that is still being worked on.
    const approved = status === "approved";
    patch.status = status;
    patch.completed_at = approved ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("festival_tasks").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/** DELETE — take a client off this festival. Body: { id } */
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("festival_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
