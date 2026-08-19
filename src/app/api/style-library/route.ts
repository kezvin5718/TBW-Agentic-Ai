import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { extractPendingPresets, STYLE_CATEGORIES } from "@/lib/style-library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One extraction batch is a handful of vision calls; give them room.
export const maxDuration = 120;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null };
  }
  return { error: null, user };
}

/** GET ?category= — presets for a category, plus counts and settings for the header. */
export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const category = new URL(request.url).searchParams.get("category") || "traditional";
  const admin = createServiceRoleClient();

  // "auto" is the unsorted inbox: rows uploaded without a shelf, still
  // waiting for extraction (or failed) — they move to a real shelf once sorted.
  const presetQuery = admin.from("style_presets").select("*").order("created_at", { ascending: false }).limit(300);
  const [{ data: presets }, { data: cats }, { data: counts }, { data: clients }] = await Promise.all([
    category === "auto" ? presetQuery.is("category", null) : presetQuery.eq("category", category),
    admin.from("style_categories").select("*").order("key"),
    admin.from("style_presets").select("category, status"),
    admin.from("clients").select("id, name, default_style_category").is("archived_at", null).order("name"),
  ]);

  const byCat: Record<string, { approved: number; pending: number; failed: number }> = {};
  for (const key of [...STYLE_CATEGORIES, "auto"]) byCat[key] = { approved: 0, pending: 0, failed: 0 };
  for (const row of counts || []) {
    const c = byCat[(row.category as string | null) || "auto"];
    if (!c) continue;
    if (row.status === "approved") c.approved++;
    else if (row.status === "pending") c.pending++;
    else if (row.status === "failed") c.failed++;
  }

  return NextResponse.json({
    success: true,
    presets: presets || [],
    categories: cats || [],
    counts: byCat,
    clients: clients || [],
  });
}

/**
 * POST — actions:
 *  { action: "extract" }                      → process a batch of pending rows
 *  { action: "review", id, ... }              → star/status/tags/subject edits
 *  { action: "category", key, font_primary?, font_secondary?, notes? }
 *  { action: "clientDefault", clientId, category|null }
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const body = await request.json();
  const admin = createServiceRoleClient();

  if (body.action === "extract") {
    const result = await extractPendingPresets(5);
    return NextResponse.json({ success: true, ...result });
  }

  if (body.action === "review") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined && ["approved", "rejected", "pending"].includes(body.status)) patch.status = body.status;
    // Moving a card to another shelf is a human decision — the auto badge comes off.
    if (body.category !== undefined && (STYLE_CATEGORIES as readonly string[]).includes(body.category)) {
      patch.category = body.category;
      patch.auto_sorted = false;
    }
    if (body.starred !== undefined) patch.starred = !!body.starred;
    if (body.tags !== undefined) patch.tags = (body.tags as string[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
    if (body.subject !== undefined) patch.subject = String(body.subject).trim() || null;
    const { error } = await admin.from("style_presets").update(patch).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "category") {
    if (!(STYLE_CATEGORIES as readonly string[]).includes(body.key)) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.font_primary !== undefined) patch.font_primary = String(body.font_primary).trim() || null;
    if (body.font_secondary !== undefined) patch.font_secondary = String(body.font_secondary).trim() || null;
    if (body.notes !== undefined) patch.notes = String(body.notes).trim() || null;
    const { error } = await admin.from("style_categories").update(patch).eq("key", body.key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "clientDefault") {
    const category = body.category || null;
    if (category && !(STYLE_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }
    const { error } = await admin.from("clients").update({ default_style_category: category }).eq("id", body.clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** DELETE ?id= — remove a preset row. The Drive file stays (it's the archive). */
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("style_presets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
