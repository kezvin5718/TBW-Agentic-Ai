import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuote } from "@/lib/portfolio-data";

// Founder Zone — holdings CRUD. Tickers are Yahoo Finance symbols (.NS/.BO);
// POST verifies the symbol returns a live price before saving so typos fail loudly.

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
    .from("founder_holdings")
    .select("*")
    .order("account")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, holdings: data || [] });
}

export async function POST(request: Request) {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const body = await request.json();
  const ticker = (body.ticker || "").trim().toUpperCase();
  const account = (body.account || "").trim();
  const avg = Number(body.avg);
  const qty = Number(body.qty);

  if (!ticker || !account) {
    return NextResponse.json({ error: "ticker and account are required" }, { status: 400 });
  }
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "avg and qty must be positive numbers" }, { status: 400 });
  }

  // Validate the symbol against Yahoo before saving (catches typos / wrong suffix)
  const quote = await fetchQuote(ticker);
  if (!quote) {
    return NextResponse.json(
      {
        error: `No live price found for "${ticker}". Use the Yahoo Finance symbol — NSE stocks end in .NS (e.g. SUZLON.NS), BSE stocks in .BO (e.g. SBFL.BO).`,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("founder_holdings")
    .upsert(
      {
        ...(body.id ? { id: body.id } : {}),
        account,
        ticker,
        name: body.name || ticker,
        avg,
        qty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account,ticker" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, holding: data, livePrice: quote.price });
}

export async function DELETE(request: Request) {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("founder_holdings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
