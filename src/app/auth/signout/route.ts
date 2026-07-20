import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  // Check if session exists
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    await supabase.auth.signOut();
  }

  const envUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital";
  const baseAppUrl = (envUrl.includes("next_public") || envUrl.includes("0.0.0.0") || envUrl.includes("localhost"))
    ? "https://bron.digital"
    : envUrl.trim().replace(/\/+$/, "");

  return NextResponse.redirect(new URL("/login", baseAppUrl), {
    status: 303, // Redirect after POST
  });
}
