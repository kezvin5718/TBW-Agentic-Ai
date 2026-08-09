import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { analysePlan } from "@/lib/post-designer";
import { generatePlanPosts } from "@/lib/post-studio";
import { describeImageViaVision, isImageGenerationConfigured } from "@/lib/integrations/openai-images";

export const dynamic = "force-dynamic";
// Designing, rendering and checking a month of posts is slow work.
export const maxDuration = 600;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/** GET ?planId= — what this plan needs before anything can be made. */
export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const planId = new URL(request.url).searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  try {
    const plan = await analysePlan(planId);
    const admin = createServiceRoleClient();
    const [{ data: photos }, { data: made }] = await Promise.all([
      admin.from("plan_product_photos").select("*").eq("plan_id", planId).order("seq"),
      admin.from("creatives").select("id, plan_item, frame_index, media_url, qc_status, founder_approval").eq("plan_id", planId),
    ]);

    return NextResponse.json({
      success: true,
      ...plan,
      photos: photos || [],
      alreadyMade: made || [],
      imagesReady: isImageGenerationConfigured(),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read the plan" }, { status: 500 });
  }
}

/**
 * POST — three steps of the same job.
 *
 *  action "photos"   — record the product photos supplied for this plan and
 *                      have vision describe each, so they can be paired.
 *  action "pair"     — propose which photo belongs to which post.
 *  action "generate" — build everything and file it in Creative Approvals.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const body = await request.json();
  const planId = body.planId;
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  const admin = createServiceRoleClient();

  if (body.action === "photos") {
    const incoming: Array<{ url: string; fileName?: string }> = Array.isArray(body.photos) ? body.photos : [];
    if (incoming.length === 0) return NextResponse.json({ error: "No photos given" }, { status: 400 });

    const { data: plan } = await admin.from("monthly_plans").select("client_id").eq("id", planId).single();
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const { data: existing } = await admin.from("plan_product_photos").select("seq").eq("plan_id", planId).order("seq", { ascending: false }).limit(1);
    let seq = (existing?.[0]?.seq ?? 0) + 1;

    const rows = [];
    for (const p of incoming) {
      // Knowing what is in the picture is what lets us pair it with the right
      // post rather than relying on upload order.
      let description = "";
      try {
        description = await describeImageViaVision(
          p.url,
          "Describe this jewellery or product photograph in under 25 words: what the piece is, its metal and stones, and the occasion it suits."
        );
      } catch { /* pairing falls back to order */ }

      rows.push({
        plan_id: planId,
        client_id: plan.client_id,
        seq: seq++,
        image_url: p.url,
        file_name: p.fileName || null,
        description: description || null,
        uploaded_by: guard.user!.id,
      });
    }

    const { error } = await admin.from("plan_product_photos").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, added: rows.length });
  }

  if (body.action === "pair") {
    try {
      const plan = await analysePlan(planId);
      const { data: photos } = await admin.from("plan_product_photos").select("*").eq("plan_id", planId).order("seq");
      const pool = photos || [];
      const productPosts = plan.specs.filter((s) => s.kind === "product");

      // Round-robin by sequence. Deliberately simple and predictable: the team
      // already works in numbered files, and a reviewer can re-pair by hand.
      const pairing: Record<string, string[]> = {};
      let cursor = 0;
      for (const spec of productPosts) {
        const picks: string[] = [];
        for (let f = 0; f < spec.frames; f++) {
          const photo = pool[cursor % Math.max(1, pool.length)];
          if (photo) picks.push(photo.image_url);
          cursor++;
        }
        pairing[String(spec.item)] = picks;
      }

      return NextResponse.json({ success: true, pairing, photos: pool, specs: plan.specs });
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not pair" }, { status: 500 });
    }
  }

  if (body.action === "generate") {
    if (!isImageGenerationConfigured()) {
      return NextResponse.json(
        { error: "Image generation needs OPENROUTER_API_KEY (or OPENAI_API_KEY) on the server." },
        { status: 400 }
      );
    }
    try {
      const items = Array.isArray(body.items) ? body.items.map(Number).filter(Number.isFinite) : undefined;
      const result = await generatePlanPosts(planId, body.pairing || {}, { items, limit: Number(body.limit) || 30 });
      return NextResponse.json({
        success: result.failed === 0,
        ...result,
        message: `${result.created} creative(s) are waiting in Creative Approvals.`,
      });
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Generation failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
