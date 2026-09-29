import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { WHATSAPP_AI_KEY, isWhatsAppAiOn } from "@/lib/whatsapp-ai-switch";

export const dynamic = "force-dynamic";

/** GET — is the WhatsApp AI spending credits? Any staff member may see it. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ success: true, on: await isWhatsAppAiOn(), canToggle: role === "founder" });
}

/** PATCH — flip it. Body: { on: boolean }. Credits are the founder's to spend. */
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
    .upsert({ key: WHATSAPP_AI_KEY, value: { state: on === true ? "on" : "off" } }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, on: on === true });
}
