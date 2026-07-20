import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Verify user session and role (Only Founder can onboard clients)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders or Employees can onboard clients", { status: 403 });
    }

    // 2. Parse request payload
    const body = await request.json();
    const {
      name,
      logoUrl,
      guidelinesUrl,
      socialAccounts,
      products,
      targetAudience,
      deliverablesPerMonth,
      adBudget,
      whatsappGroupId,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Brand Name is required" }, { status: 400 });
    }

    // 3. Insert Client Record into Supabase
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        logo_url: logoUrl || "",
        guidelines_url: guidelinesUrl || "",
        social_accounts: socialAccounts || {},
        products: products || [],
        target_audience: targetAudience || "",
        deliverables_per_month: Number(deliverablesPerMonth) || 0,
        ad_budget: Number(adBudget) || 0,
        whatsapp_group_id: whatsappGroupId || "",
      })
      .select()
      .single();

    if (clientError || !client) {
      console.error("Database error inserting client:", clientError);
      return NextResponse.json({ error: clientError?.message || "Failed to create client" }, { status: 500 });
    }

    // 4. Initialize an empty Brand Brain record
    const { data: brandBrain, error: brainError } = await supabase
      .from("brand_brain")
      .insert({
        client_id: client.id,
        colors: [],
        fonts: [],
        caption_tone: "",
        design_preferences: {},
        addresses: [],
        past_creatives: [],
        feedback_log: [],
        results_log: [],
        brand_brief: "",
      })
      .select()
      .single();

    if (brainError) {
      console.error("Database error inserting empty brand brain:", brainError);
      // We don't fail the whole request since client is already created, but we log the error.
    }

    return NextResponse.json({
      success: true,
      client,
      brandBrain,
    });
  } catch (error: unknown) {
    console.error("Onboarding request error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Verify user session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders or Employees can view clients", { status: 403 });
    }

    const { data: clients, error } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("Database error fetching onboarding clients:", error);
      return NextResponse.json({ error: error.message || "Failed to fetch clients" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      clients: clients || [],
    });
  } catch (error: unknown) {
    console.error("Onboarding GET request error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
