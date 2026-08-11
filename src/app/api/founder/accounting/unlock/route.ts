import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNTING_COOKIE, checkAccountingPassword, issueAccountingToken } from "@/lib/accounting-lock";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  if (role !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!checkAccountingPassword(password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const { token, maxAge } = issueAccountingToken();
  const res = NextResponse.json({ success: true });
  res.cookies.set(ACCOUNTING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  return res;
}
