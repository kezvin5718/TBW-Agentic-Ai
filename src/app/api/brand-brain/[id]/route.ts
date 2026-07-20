import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET client and brand brain details
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // 1. Fetch client details
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Fetch linked brand_brain
    const { data: brandBrain } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", id)
      .single();

    return NextResponse.json({
      client,
      brandBrain: brandBrain || null,
    });
  } catch (error: unknown) {
    console.error("GET Brand Brain error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// PUT (update) client and brand brain details
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      deliverablesPerMonth,
      adBudget,
      whatsappGroupId,
      targetAudience,
      products,
      colors,
      fonts,
      captionTone,
      designPreferences,
    } = body;

    // 1. Update Client fields
    const { error: clientUpdateErr } = await supabase
      .from("clients")
      .update({
        name: name,
        deliverables_per_month: Number(deliverablesPerMonth),
        ad_budget: Number(adBudget),
        whatsapp_group_id: whatsappGroupId,
        target_audience: targetAudience,
        products: products,
      })
      .eq("id", id);

    if (clientUpdateErr) {
      return NextResponse.json({ error: clientUpdateErr.message }, { status: 500 });
    }

    // 2. Update Brand Brain fields
    const { error: brainUpdateErr } = await supabase
      .from("brand_brain")
      .update({
        colors: colors || [],
        fonts: fonts || [],
        caption_tone: captionTone || "",
        design_preferences: designPreferences || {},
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", id);

    if (brainUpdateErr) {
      return NextResponse.json({ error: brainUpdateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("PUT Brand Brain error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
