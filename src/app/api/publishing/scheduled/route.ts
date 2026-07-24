import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    let query = supabase
      .from("scheduled_posts")
      .select("*, clients(id, name)")
      .order("scheduled_for", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data: posts, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, posts: posts || [] });
  } catch (error: unknown) {
    console.error("Fetch scheduled posts error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders/Employees can schedule posts", { status: 403 });
    }

    const body = await request.json();
    const { clientId, mediaUrl, caption, platform, scheduledFor } = body;

    if (!clientId || !mediaUrl || !platform || !scheduledFor) {
      return NextResponse.json({ error: "Missing required post parameters" }, { status: 400 });
    }

    const { data: post, error } = await supabase
      .from("scheduled_posts")
      .insert({
        client_id: clientId,
        media_url: mediaUrl,
        caption,
        platform,
        scheduled_for: scheduledFor,
        status: "scheduled",
        attempts: 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      post,
    });
  } catch (error: unknown) {
    console.error("Create scheduled post error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
