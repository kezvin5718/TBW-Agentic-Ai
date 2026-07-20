import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: history, error } = await supabase
      .from("studio_generations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load studio generations history:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("Studio history error:", error);
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
  }
}
