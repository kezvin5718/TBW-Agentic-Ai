import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * POST /api/planning/brand-gaps   { clientId, colors?: string[], fonts?: string[] }
 *
 * Fills the brand fields the planning wizard asked about, once, so every future
 * plan for this client inherits them.
 *
 * Deliberately additive and narrow. The general brand-brain PUT rewrites
 * colors, fonts, caption_tone and design_preferences together, so calling it
 * from here would blank the caption tone — which for most clients is the only
 * populated field they have. This only ever writes a field that is empty.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clientId, colors, fonts } = await request.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const cleanColors = Array.isArray(colors)
    ? Array.from(new Set(colors.map((c: unknown) => String(c).trim()).filter((c) => HEX.test(c)))).slice(0, 8)
    : [];
  const cleanFonts = Array.isArray(fonts)
    ? Array.from(new Set(fonts.map((f: unknown) => String(f).trim()).filter(Boolean))).slice(0, 4)
    : [];

  if (cleanColors.length === 0 && cleanFonts.length === 0) {
    return NextResponse.json({ success: true, written: [], note: "Nothing usable given — no change made." });
  }

  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from("brand_brain")
    .select("client_id, colors, fonts")
    .eq("client_id", clientId)
    .maybeSingle();

  const hasColors = Array.isArray(existing?.colors) && (existing!.colors as unknown[]).length > 0;
  const hasFonts = Array.isArray(existing?.fonts) && (existing!.fonts as unknown[]).length > 0;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const written: string[] = [];
  // Never overwrite a brand value someone already set — this screen is for
  // filling blanks, not for correcting them.
  if (cleanColors.length && !hasColors) { patch.colors = cleanColors; written.push("colors"); }
  if (cleanFonts.length && !hasFonts) { patch.fonts = cleanFonts; written.push("fonts"); }

  if (written.length === 0) {
    return NextResponse.json({ success: true, written: [], note: "Already on file — left as it was." });
  }

  const { error } = existing
    ? await admin.from("brand_brain").update(patch).eq("client_id", clientId)
    : await admin.from("brand_brain").insert({ client_id: clientId, ...patch });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, written });
}
