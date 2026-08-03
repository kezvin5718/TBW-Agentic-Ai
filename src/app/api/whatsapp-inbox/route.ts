import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET — list inbox items (newest first). ?status=new|assigned|done|dismissed
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = new URL(request.url).searchParams.get("status");
  let q = supabase
    .from("wa_inbox")
    .select("*, clients(name), profiles:assigned_to(name)")
    .order("received_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, items: data || [] });
}

// PATCH — act on an item: assign / done / dismiss. Body: { id, action, assignedTo? }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, action, assignedTo } = await request.json();
  if (!id || !action) return NextResponse.json({ error: "id and action are required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const patch: Record<string, unknown> = {};
  if (action === "assign") {
    patch.status = "assigned";
    patch.assigned_to = assignedTo || user.id; // default: assign to me
  } else if (action === "done") {
    patch.status = "done";
  } else if (action === "dismiss") {
    patch.status = "dismissed";
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { error } = await admin.from("wa_inbox").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
