import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isRecurPostConfigured } from "@/lib/recurpost";

export const dynamic = "force-dynamic";

// GET — is the Zapier webhook configured? (URL itself only shown to founders)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  const { data } = await admin.from("agency_settings").select("value").eq("key", "zapier_webhook_url").maybeSingle();
  const url = (data?.value as { url?: string } | null)?.url || "";
  return NextResponse.json({
    success: true,
    configured: !!url,
    url: role === "founder" ? url : undefined,
    recurpostConfigured: isRecurPostConfigured(),
  });
}

// POST — set the Zapier webhook URL (founder only). Body: { url }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") return NextResponse.json({ error: "Founder only" }, { status: 403 });

  const { url } = await request.json();
  if (!url || !/^https:\/\/hooks\.zapier\.com\//.test(url)) {
    return NextResponse.json({ error: "Enter a valid Zapier webhook URL (https://hooks.zapier.com/…)" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  await admin.from("agency_settings").upsert({ key: "zapier_webhook_url", value: { url } }, { onConflict: "key" });
  return NextResponse.json({ success: true });
}
