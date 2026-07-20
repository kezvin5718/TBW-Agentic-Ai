import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
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
    const { name, type, url, platform } = body;

    if (!name || !url) {
      return NextResponse.json({ error: "Creative Name and URL are required" }, { status: 400 });
    }

    // 1. Fetch current creatives list
    const { data: brandBrain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("past_creatives")
      .eq("client_id", id)
      .single();

    if (brainErr || !brandBrain) {
      return NextResponse.json({ error: "Brand Brain profile not found" }, { status: 404 });
    }

    const currentCreatives = Array.isArray(brandBrain.past_creatives) ? brandBrain.past_creatives : [];

    // 2. Append new asset reference
    const newAsset = {
      name: name.trim(),
      type: type || "image",
      url: url,
      platform: platform || "instagram",
      uploadedAt: new Date().toISOString(),
    };

    const updatedCreatives = [newAsset, ...currentCreatives];

    // 3. Save to database
    const { data: updatedBrain, error: updateErr } = await supabase
      .from("brand_brain")
      .update({
        past_creatives: updatedCreatives,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", id)
      .select("past_creatives")
      .single();

    if (updateErr) {
      console.error("Failed to append creative reference:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      pastCreatives: updatedBrain.past_creatives,
    });
  } catch (error: unknown) {
    console.error("Creative asset append request error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
