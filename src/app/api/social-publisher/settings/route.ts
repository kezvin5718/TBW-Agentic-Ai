import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRecurPostConfigured } from "@/lib/recurpost";

export const dynamic = "force-dynamic";

// GET — posting-connection status (RecurPost only; Zapier has been removed).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ success: true, recurpostConfigured: isRecurPostConfigured() });
}
