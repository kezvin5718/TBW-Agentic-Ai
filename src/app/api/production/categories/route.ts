import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET: Retrieve all generation categories sorted by sort_order
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role || "client";
    const selectFields = role === "founder"
      ? "*"
      : "id, name, description, category_type, engine, default_model, default_aspect_ratio, sort_order, is_active";

    const { data: categories, error } = await supabase
      .from("generation_categories")
      .select(selectFields)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, categories });
  } catch (error: unknown) {
    console.error("GET Generation Categories Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// POST: Add a new generation category. Founder-only.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { name, description, prompt_prefix, prompt_suffix, scaffold_json, default_model, default_aspect_ratio, engine, category_type } = body;

    if (!name) {
      return NextResponse.json({ error: "Missing required category fields" }, { status: 400 });
    }

    // Get current count for next sort order
    const { count } = await supabase
      .from("generation_categories")
      .select("*", { count: "exact", head: true });

    const nextSortOrder = (count || 0) + 1;

    const { data: newCategory, error } = await supabase
      .from("generation_categories")
      .insert({
        name,
        description: description || "",
        prompt_prefix: prompt_prefix || "",
        prompt_suffix: prompt_suffix || "",
        scaffold_json: scaffold_json !== undefined ? scaffold_json : null,
        default_model: default_model || "",
        default_aspect_ratio: default_aspect_ratio || "1:1",
        engine: engine || "higgsfield",
        category_type: category_type || "standard",
        sort_order: nextSortOrder,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, category: newCategory });
  } catch (error: unknown) {
    console.error("POST Generation Category Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// PUT: Edit category details. Founder-only.
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { id, name, description, prompt_prefix, prompt_suffix, scaffold_json, default_model, default_aspect_ratio, sort_order, is_active, engine, category_type } = body;

    if (!id) {
      return NextResponse.json({ error: "Category ID is required" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (name !== undefined) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description;
    if (prompt_prefix !== undefined) updatePayload.prompt_prefix = prompt_prefix;
    if (prompt_suffix !== undefined) updatePayload.prompt_suffix = prompt_suffix;
    if (scaffold_json !== undefined) updatePayload.scaffold_json = scaffold_json;
    if (default_model !== undefined) updatePayload.default_model = default_model;
    if (default_aspect_ratio !== undefined) updatePayload.default_aspect_ratio = default_aspect_ratio;
    if (sort_order !== undefined) updatePayload.sort_order = sort_order;
    if (is_active !== undefined) updatePayload.is_active = is_active;
    if (engine !== undefined) updatePayload.engine = engine;
    if (category_type !== undefined) updatePayload.category_type = category_type;

    const { data: updatedCategory, error } = await supabase
      .from("generation_categories")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, category: updatedCategory });
  } catch (error: unknown) {
    console.error("PUT Generation Category Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// DELETE: Delete a category completely. Founder-only.
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "founder") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Category ID is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("generation_categories")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: "Category deleted successfully" });
  } catch (error: unknown) {
    console.error("DELETE Generation Category Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
