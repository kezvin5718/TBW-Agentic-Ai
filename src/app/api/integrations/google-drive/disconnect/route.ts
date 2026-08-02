import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnectDrive } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await disconnectDrive();
  return NextResponse.json({ success: true });
}
