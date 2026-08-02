import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUrl, isConfigured, getBaseAppUrl } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") {
    return NextResponse.redirect(new URL("/dashboard", getBaseAppUrl()));
  }
  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?drive=notconfigured", getBaseAppUrl()));
  }
  return NextResponse.redirect(getAuthUrl());
}
