import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveStatus } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await getDriveStatus();
  return NextResponse.json({ success: true, ...status });
}
