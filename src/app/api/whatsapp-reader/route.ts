import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET — current reader status (QR / connection / heartbeat).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  const { data } = await admin.from("wa_reader_status").select("*").eq("id", 1).maybeSingle();
  return NextResponse.json({ success: true, status: data || null });
}

// POST — request a re-link (the reader clears its session and shows a fresh QR).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") {
    return NextResponse.json({ error: "Forbidden — founder only" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  await admin.from("wa_reader_status").update({ relink_requested: true }).eq("id", 1);
  return NextResponse.json({ success: true });
}
