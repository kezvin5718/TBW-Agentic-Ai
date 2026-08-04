import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Founder Zone — written theses per position. RLS also enforces founder-only,
// but we gate here too so the API fails loudly rather than returning empty sets.

async function requireFounder() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: new NextResponse("Unauthorized", { status: 401 }) };
  if (user.user_metadata?.role !== "founder") {
    return { supabase, error: new NextResponse("Forbidden", { status: 403 }) };
  }
  return { supabase, error: null };
}

export async function GET() {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const { data, error } = await supabase
    .from("founder_theses")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, theses: data || [] });
}

export async function POST(request: Request) {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const body = await request.json();
  if (!body.ticker?.trim()) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("founder_theses")
    .upsert(
      {
        ticker: body.ticker.trim(),
        name: body.name || "",
        thesis: body.thesis || "",
        wrong_if: body.wrong_if || "",
        checkpoints: body.checkpoints || "",
        status: body.status || "on_thesis",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticker" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, thesis: data });
}

export async function DELETE(request: Request) {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const { ticker } = await request.json();
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  const { error } = await supabase.from("founder_theses").delete().eq("ticker", ticker);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
