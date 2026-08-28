import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { PM_AUTO_ASSIGN_KEY, isAutoAssignOn } from "@/lib/pm-auto-assign";

export const dynamic = "force-dynamic";

/** GET — is the PM assigning by itself? Any staff member may see the state. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ success: true, on: await isAutoAssignOn(), canToggle: role === "founder" });
}

/** PATCH — flip it. Body: { on: boolean }. Only the founder decides this. */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  if (role !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { on } = await request.json().catch(() => ({}));
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("agency_settings")
    .upsert({ key: PM_AUTO_ASSIGN_KEY, value: { state: on === true ? "on" : "off" } }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, on: on === true });
}
