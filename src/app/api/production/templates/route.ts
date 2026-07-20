import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET: Retrieve all active prompt templates sorted by sort_order
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

    const { data: templates, error } = await supabase
      .from("prompt_templates")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, templates });
  } catch (error: unknown) {
    console.error("GET Prompt Templates Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// POST: Add a new template. Founders can add immediately; employees queue a confirmation request.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    const body = await request.json();
    const { name, category, prompt_text, default_model, default_ratio } = body;

    if (!name || !prompt_text || !default_model) {
      return NextResponse.json({ error: "Missing required template fields" }, { status: 400 });
    }

    // Get current template count for sorting order
    const { count: templateCount } = await supabase
      .from("prompt_templates")
      .select("*", { count: "exact", head: true });

    const nextSortOrder = (templateCount || 0) + 1;

    if (role === "founder") {
      // Save directly
      const { data: newTemplate, error } = await supabase
        .from("prompt_templates")
        .insert({
          name,
          category: category || "General",
          prompt_text,
          default_model,
          default_ratio: default_ratio || "1:1",
          sort_order: nextSortOrder,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      return NextResponse.json({ success: true, template: newTemplate });
    } else if (role === "employee") {
      // Queue approval for founder
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min expiry
      const { data: pendingAction, error: pendingErr } = await supabase
        .from("jarvis_pending_actions")
        .insert({
          action_name: "save_prompt_template",
          args: {
            name,
            category: category || "General",
            prompt_text,
            default_model,
            default_ratio: default_ratio || "1:1",
            sort_order: nextSortOrder,
          },
          expires_at: expiresAt,
          status: "pending",
        })
        .select()
        .single();

      if (pendingErr) throw pendingErr;

      return NextResponse.json({
        success: true,
        pendingApproval: true,
        message: "Template save request submitted for Founder approval.",
        pendingAction,
      });
    } else {
      return NextResponse.json({ error: "Clients cannot add templates" }, { status: 403 });
    }
  } catch (error: unknown) {
    console.error("POST Prompt Template Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// PUT: Edit template details or update sort ordering. Founder-only.
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
    const { id, name, category, prompt_text, default_model, default_ratio, sort_order, is_active } = body;

    if (!id) {
      return NextResponse.json({ error: "Template ID is required" }, { status: 400 });
    }

    const updatePayload: Record<string, string | number | boolean | undefined | null> = {};
    if (name !== undefined) updatePayload.name = name;
    if (category !== undefined) updatePayload.category = category;
    if (prompt_text !== undefined) updatePayload.prompt_text = prompt_text;
    if (default_model !== undefined) updatePayload.default_model = default_model;
    if (default_ratio !== undefined) updatePayload.default_ratio = default_ratio;
    if (sort_order !== undefined) updatePayload.sort_order = sort_order;
    if (is_active !== undefined) updatePayload.is_active = is_active;

    const { data: updatedTemplate, error } = await supabase
      .from("prompt_templates")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, template: updatedTemplate });
  } catch (error: unknown) {
    console.error("PUT Prompt Template Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

// DELETE: Delete a template completely. Founder-only.
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
      return NextResponse.json({ error: "Template ID is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("prompt_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: "Template deleted successfully" });
  } catch (error: unknown) {
    console.error("DELETE Prompt Template Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
