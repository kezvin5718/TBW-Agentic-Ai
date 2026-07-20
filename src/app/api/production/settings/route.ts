import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: settings } = await supabase
      .from("agency_settings")
      .select("value")
      .eq("key", "default_assignees")
      .maybeSingle();

    // Fetch all profiles so they can be selected
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, role")
      .order("name");

    return NextResponse.json({
      success: true,
      defaultAssignees: settings?.value || { copy: null, image: null, video: null },
      profiles: profiles || [],
    });
  } catch (error: unknown) {
    console.error("Fetch Settings Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { defaultAssignees } = body;

    if (!defaultAssignees) {
      return NextResponse.json({ error: "defaultAssignees configuration is required" }, { status: 400 });
    }

    // Upsert key
    const adminSupabase = createServiceRoleClient();
    const { error: upsertErr } = await adminSupabase
      .from("agency_settings")
      .upsert({
        key: "default_assignees",
        value: defaultAssignees,
      });

    if (upsertErr) {
      throw upsertErr;
    }

    return NextResponse.json({
      success: true,
      defaultAssignees,
    });
  } catch (error: unknown) {
    console.error("Save Settings Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
