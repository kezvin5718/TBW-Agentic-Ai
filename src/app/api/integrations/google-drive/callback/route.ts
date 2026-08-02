import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeAndSave, getBaseAppUrl } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const base = getBaseAppUrl();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") {
    return NextResponse.redirect(new URL("/dashboard", base));
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) {
    return NextResponse.redirect(new URL(`/dashboard/settings/integrations?drive=error&reason=${encodeURIComponent(error)}`, base));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?drive=error&reason=nocode", base));
  }

  try {
    await exchangeCodeAndSave(code);
    return NextResponse.redirect(new URL("/dashboard/settings/integrations?drive=connected", base));
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "exchange_failed";
    return NextResponse.redirect(new URL(`/dashboard/settings/integrations?drive=error&reason=${encodeURIComponent(reason)}`, base));
  }
}
