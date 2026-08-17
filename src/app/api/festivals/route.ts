import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { istWallClockToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null };
  }
  return { error: null, user };
}

/**
 * The single source of festival names.
 *
 * Production categories already carry a festival_post template with a
 * {festival_name} placeholder; this table is what that name comes from, so the
 * agency keeps one list rather than two that drift apart.
 */

// GET — every festival, soonest first.
export async function GET() {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("festivals")
    .select("*, profiles:created_by(name)")
    .order("scheduled_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, festivals: data || [] });
}

// POST — add a festival. Body: { name, date: "YYYY-MM-DD", time: "HH:mm", notes? }
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { name, date, time, notes } = await request.json();
  const clean = String(name || "").trim();
  if (!clean) return NextResponse.json({ error: "Give the festival a name." }, { status: 400 });
  if (!date || !time) return NextResponse.json({ error: "Set the date and time this festival posts at." }, { status: 400 });

  // The pickers are IST wall clock, same as everywhere else in the app.
  const when = istWallClockToUtc(`${date}T${time}`);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "That date and time could not be read." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("festivals")
    .insert({
      name: clean,
      scheduled_at: when.toISOString(),
      notes: String(notes || "").trim() || null,
      created_by: guard.user!.id,
    })
    .select()
    .single();

  if (error) {
    // The unique index is on lower(name) — two "Diwali" entries would make the
    // picker ambiguous and defeat the point of a single source.
    if (/duplicate key|festivals_name_key/i.test(error.message)) {
      return NextResponse.json({ error: `"${clean}" is already on the list. Edit that one instead.` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, festival: data });
}

// PATCH — correct a festival's name or timing. Body: { id, name?, date?, time?, notes? }
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id, name, date, time, notes } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) return NextResponse.json({ error: "The name can't be empty." }, { status: 400 });
    patch.name = clean;
  }
  if (date && time) {
    const when = istWallClockToUtc(`${date}T${time}`);
    if (Number.isNaN(when.getTime())) return NextResponse.json({ error: "That date and time could not be read." }, { status: 400 });
    patch.scheduled_at = when.toISOString();
  }
  if (notes !== undefined) patch.notes = String(notes).trim() || null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("festivals").update(patch).eq("id", id);
  if (error) {
    if (/duplicate key|festivals_name_key/i.test(error.message)) {
      return NextResponse.json({ error: "Another festival already has that name." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — remove a festival added by mistake. Body: { id }
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();

  // Creatives already uploaded against it keep their file and their row — the
  // link is cleared, not the work. Say how many so the deletion isn't blind.
  const { count } = await admin
    .from("creative_uploads")
    .select("id", { count: "exact", head: true })
    .eq("festival_id", id);

  const { error } = await admin.from("festivals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    detachedUploads: count || 0,
    note: count ? `${count} uploaded creative(s) are no longer linked to a festival, but nothing was deleted.` : null,
  });
}
