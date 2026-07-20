import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    // Verify session to ensure caller is Founder or Employee
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !["founder", "employee"].includes(user.user_metadata?.role)) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in as a Founder or Employee before seeding the database." },
        { status: 401 }
      );
    }

    // 1. Check if SWAD client already exists
    let { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("name", "SWAD")
      .maybeSingle();

    if (!client) {
      // Insert SWAD client details
      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({
          name: "SWAD",
          logo_url: "logos/swad_logo.png",
          guidelines_url: "guidelines/swad_guidelines.pdf",
          social_accounts: {
            instagram: "@swad_foods",
            facebook: "swadfoods",
          },
          products: [
            "Swad Pickles (Mango, Lime, Chili, Mixed)",
            "Swad Traditional Spices (Garam Masala, Turmeric, Coriander)",
            "Swad Ready-To-Eat Meals (Dal Makhani, Paneer Tikka, Veg Biryani)",
          ],
          target_audience: "Indian Diaspora (NRIs) globally and busy urban Indian households seeking authentic, traditional taste and convenience in spices, pickles, and ready-to-eat meals.",
          deliverables_per_month: 8,
          ad_budget: 150000,
          whatsapp_group_id: "1203632148729_swad@g.us",
        })
        .select()
        .single();

      if (clientError || !newClient) {
        console.error("Seeding client insert failed:", clientError);
        throw new Error(`Seeding client insert failed: ${clientError?.message}`);
      }
      client = newClient;
    }

    // 2. Check if SWAD Brand Brain already exists
    let { data: brandBrain } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();

    if (!brandBrain) {
      // Insert SWAD Brand Brain profile
      const { data: newBrain, error: brainError } = await supabase
        .from("brand_brain")
        .insert({
          client_id: client.id,
          colors: ["#c21807", "#f4a261", "#2a9d8f", "#0f172a"],
          fonts: ["Playfair Display", "Montserrat"],
          caption_tone: "Warm, nostalgic, and rich in culinary pride. Evoke memories of home-cooked meals.",
          design_preferences: {
            imagery: "high-contrast, warm-lit close-ups of food textures",
            graphics: "subtle traditional patterns and gold-embellished accents",
            layout: "editorial, focusing on rich colors",
          },
          addresses: [
            { label: "India HQ", city: "Ahmedabad", state: "Gujarat", country: "India" }
          ],
          past_creatives: [
            {
              name: "Swad Pickles Launch Reel",
              type: "video",
              url: "creatives/swad_pickle_reel_launch.mp4",
              platform: "instagram",
            }
          ],
          feedback_log: [],
          results_log: [],
          brand_brief: "SWAD Foods brings the authentic taste of India to tables worldwide. Key focus is on sensory experiences, visual warmth, and nostalgic storytelling.",
        })
        .select()
        .single();

      if (brainError || !newBrain) {
        console.error("Seeding brand brain insert failed:", brainError);
        throw new Error(`Seeding brand brain insert failed: ${brainError?.message}`);
      }
      brandBrain = newBrain;
    }

    // 3. Ensure a test monthly plan exists
    let { data: plan } = await supabase
      .from("monthly_plans")
      .select("*")
      .eq("client_id", client.id)
      .eq("month", "2026-08-01")
      .maybeSingle();

    if (!plan) {
      const { data: newPlan, error: planError } = await supabase
        .from("monthly_plans")
        .insert({
          client_id: client.id,
          month: "2026-08-01",
          strategy_summary: "August Campaign for SWAD Foods",
          content_pillars: ["product showcase", "customer review"],
          status: "approved",
        })
        .select()
        .single();

      if (planError || !newPlan) {
        console.error("Seeding plan failed:", planError);
        throw new Error(`Seeding plan failed: ${planError?.message}`);
      }
      plan = newPlan;
    }

    // 4. Ensure sample tasks exist
    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("plan_id", plan.id);

    if (!existingTasks || existingTasks.length === 0) {
      const { error: taskError } = await supabase
        .from("tasks")
        .insert([
          {
            plan_id: plan.id,
            type: "image",
            deadline: new Date(Date.now() + 86400000 * 5).toISOString(),
            priority: "high",
            status: "todo",
            metadata: {
              concept: "Traditional Mango Pickle Jar with spices packaging layout",
            },
          },
          {
            plan_id: plan.id,
            type: "video",
            deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
            priority: "medium",
            status: "todo",
            metadata: {
              concept: "Nostalgic spices storytelling animation",
            },
          },
          {
            plan_id: plan.id,
            type: "copy",
            deadline: new Date(Date.now() + 86400000 * 2).toISOString(),
            priority: "low",
            status: "todo",
            metadata: {
              concept: "Instagram caption for ready-to-eat Dal Makhani launch",
            },
          }
        ]);

      if (taskError) {
        console.error("Seeding tasks failed:", taskError);
        throw new Error(`Seeding tasks failed: ${taskError.message}`);
      }
    }

    // 5. Seed Starter Prompt Templates
    const { count: templateCount } = await supabase
      .from("prompt_templates")
      .select("*", { count: "exact", head: true });

    if (templateCount === 0) {
      const { error: seedTemplatesError } = await supabase
        .from("prompt_templates")
        .insert([
          {
            name: "Clean Product Shot",
            category: "Product Shot",
            prompt_text: "Studio shot of {product} on cream background, soft daylight",
            default_model: "nano_banana",
            default_ratio: "1:1",
            sort_order: 1,
            is_active: true,
          },
          {
            name: "Lifestyle Scene",
            category: "Lifestyle",
            prompt_text: "A lifestyle shot of {product} being used in a modern Indian home, warm sun beams",
            default_model: "gpt_image",
            default_ratio: "16:9",
            sort_order: 2,
            is_active: true,
          },
          {
            name: "Festive/Seasonal",
            category: "Festive",
            prompt_text: "Festive celebration scene featuring {product} with traditional Diya lamps and flower decorations for Diwali",
            default_model: "gpt_image",
            default_ratio: "1:1",
            sort_order: 3,
            is_active: true,
          },
          {
            name: "Flat Lay",
            category: "Flat Lay",
            prompt_text: "Flat lay composition of {product} surrounded by fresh ingredients like spices, herbs, and oils, top-down perspective",
            default_model: "nano_banana",
            default_ratio: "1:1",
            sort_order: 4,
            is_active: true,
          },
          {
            name: "UGC-Style Handheld",
            category: "UGC Style",
            prompt_text: "Handheld UGC-style smartphone photo of a person holding {product} package, natural background",
            default_model: "nano_banana",
            default_ratio: "9:16",
            sort_order: 5,
            is_active: true,
          },
        ]);

      if (seedTemplatesError) {
        console.error("Seeding prompt templates failed:", seedTemplatesError);
        throw new Error(`Seeding prompt templates failed: ${seedTemplatesError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database successfully seeded with SWAD client, brand brain, plans, production tasks, and starter templates",
      clientId: client.id,
      planId: plan.id,
    });
  } catch (error: unknown) {
    console.error("Seeding script error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
