import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

/**
 * The DM contact directory. WhatsApp display names are whatever the sender
 * typed on their own phone, so the label given here is the authority — the
 * same relationship qc_allowed_brands has to what vision thinks it sees.
 */

// GET — every known DM sender, unnamed first.
export async function GET() {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("wa_contacts")
    .select("*, clients(name)")
    .order("status", { ascending: false }) // 'new' after 'assigned' alphabetically — fix below
    .order("first_seen", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  return NextResponse.json({
    success: true,
    contacts: rows.sort((a, b) => (a.status === "new" ? -1 : 0) - (b.status === "new" ? -1 : 0)),
    unnamed: rows.filter((r) => r.status === "new").length,
  });
}

// PATCH — name a number. Body: { number, label?, clientId?, status? }
export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { number, label, clientId, status } = await request.json();
  if (!number) return NextResponse.json({ error: "number required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (label !== undefined) patch.label = String(label).trim() || null;
  if (clientId !== undefined) patch.client_id = clientId || null;
  if (status !== undefined && ["new", "assigned", "ignored"].includes(status)) patch.status = status;
  // Naming or assigning a number is what takes it out of the tray.
  if ((label || clientId) && status === undefined) patch.status = "assigned";

  const admin = createServiceRoleClient();
  const { error } = await admin.from("wa_contacts").update(patch).eq("number", number);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
