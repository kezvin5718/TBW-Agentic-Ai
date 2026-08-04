import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Founder Zone — decision journal. Briefs and desk runs are auto-filed here;
// manual notes/decisions come through POST.

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
    .from("founder_journal")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, entries: data || [] });
}

export async function POST(request: Request) {
  const { supabase, error: authError } = await requireFounder();
  if (authError) return authError;

  const body = await request.json();
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("founder_journal")
    .insert({
      entry_type: body.entry_type || "note",
      title: body.title || "",
      content: body.content.trim(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, entry: data });
}
