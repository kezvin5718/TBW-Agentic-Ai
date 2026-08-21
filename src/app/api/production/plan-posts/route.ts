import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { analysePlan } from "@/lib/post-designer";
import { generatePlanPosts, buildScenePrompt } from "@/lib/post-studio";
import { styleBlockFor } from "@/lib/style-library";
import { describeImageViaVision, isImageGenerationConfigured, imageModelName } from "@/lib/integrations/openai-images";
import { isDriveConnected, getDriveQuota, getDriveStatus, storeToDriveStrict } from "@/lib/google-drive";
import { cleanProductPhoto } from "@/lib/product-photo";

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

  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

  try {
    const plan = await analysePlan(planId);
    const admin = createServiceRoleClient();
    // ?style= overrides; otherwise the client's default category applies.
    const styleParam = url.searchParams.get("style");
    const styleCategory = styleParam !== null ? (styleParam || null) : plan.styleDefault;

    const [{ data: photos }, { data: made }, { data: styleRows }] = await Promise.all([
      admin.from("plan_product_photos").select("*").eq("plan_id", planId).order("seq"),
      admin.from("creatives").select("id, plan_item, frame_index, media_url, qc_status, founder_approval").eq("plan_id", planId),
      admin.from("style_presets").select("category").eq("status", "approved"),
    ]);

    const styleCounts: Record<string, number> = {};
    for (const r of styleRows || []) styleCounts[r.category as string] = (styleCounts[r.category as string] || 0) + 1;

    // A calendar of near-identical rows with no art direction is the fingerprint
    // of the old wizard's filler, not of an authored plan. Building from it
    // burns money on posts nobody designed — say so instead of proceeding
    // politely. (The Shwetanki incident: 30 copies of "Creative product
    // showcase" rendered while the real 26-post plan sat unimported.)
    const { data: rawPlan } = await admin.from("monthly_plans").select("content_calendar").eq("id", planId).maybeSingle();
    const cal = (rawPlan?.content_calendar as Array<{ concept?: string; hook?: string; productionNote?: string }> | null) || [];
    const distinct = new Set(cal.map((r) => `${r.concept || ""}|${r.hook || ""}`.toLowerCase().trim()));
    const directed = cal.filter((r) => (r.productionNote || "").trim().length > 10).length;
    const looksGeneric = cal.length >= 5 && distinct.size <= 2 && directed === 0;

    const specs = await Promise.all(plan.specs.map(async (sp) => ({
      ...sp,
      imagePrompt: sp.kind === "generated" && sp.scenePrompt.trim()
        ? buildScenePrompt(sp, styleCategory ? await styleBlockFor(sp, styleCategory) : "")
        : null,
    })));

    return NextResponse.json({
      success: true,
      ...plan,
      // The exact text each generated post will send to the image model, and
      // which model that is — shown before Build so nobody pays to find out.
      specs,
      styleCategory,
      styleCounts,
      looksGeneric,
      imageModel: imageModelName(),
      photos: photos || [],
      alreadyMade: made || [],
      imagesReady: isImageGenerationConfigured(),
      driveConnected: await isDriveConnected(),
      driveError: (await getDriveStatus()).error || null,
      driveQuota: await getDriveQuota(),
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

    const { data: clientRow } = await admin.from("clients").select("name").eq("id", plan.client_id).maybeSingle();

    const rows = [];
    for (const p of incoming) {
      // Strip the border, logo and tagline first. What designers hand over is
      // usually a finished post, and building on top of one produces exactly
      // the double-branded, cropped result QC kept rejecting.
      let useUrl = p.url;
      let cleanNote = "";
      let needsHuman = false;
      try {
        const res = await fetch(p.url);
        if (res.ok) {
          const cleaned = await cleanProductPhoto(Buffer.from(await res.arrayBuffer()));
          cleanNote = cleaned.note;
          needsHuman = cleaned.needsHuman;
          if (cleaned.changed) {
            const stored = await storeToDriveStrict(
              cleaned.buffer,
              `clean-${(p.fileName || "product").replace(/\.[a-z0-9]+$/i, "")}.png`,
              "image/png",
              clientRow?.name || undefined,
              "product-photos",
              "TBW Generated Posts"
            );
            if (stored.url) useUrl = stored.url;
            else cleanNote = `${cleanNote} (could not save the cleaned copy: ${stored.error})`;
          }
        }
      } catch (err: unknown) {
        cleanNote = `could not clean the photo: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Describe the cleaned product, so pairing matches the jewellery rather
      // than whatever the original artwork happened to say.
      let description = "";
      try {
        description = await describeImageViaVision(
          useUrl,
          "Describe this jewellery or product photograph in under 25 words: what the piece is, its metal and stones, and the occasion it suits."
        );
      } catch { /* pairing falls back to order */ }

      rows.push({
        plan_id: planId,
        client_id: plan.client_id,
        seq: seq++,
        image_url: useUrl,
        original_url: useUrl === p.url ? null : p.url,
        clean_note: cleanNote || null,
        needs_human: needsHuman,
        file_name: p.fileName || null,
        description: description || null,
        uploaded_by: guard.user!.id,
      });
    }

    const { error } = await admin.from("plan_product_photos").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const flagged = rows.filter((r) => r.needs_human).map((r) => r.file_name || "a photo");
    return NextResponse.json({
      success: true,
      added: rows.length,
      cleaned: rows.filter((r) => r.original_url).length,
      needsHuman: flagged,
      notes: rows.filter((r) => r.clean_note).map((r) => `${r.file_name}: ${r.clean_note}`),
    });
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
      const result = await generatePlanPosts(planId, body.pairing || {}, {
        items,
        limit: Number(body.limit) || 30,
        styleCategory: typeof body.styleCategory === "string" && body.styleCategory ? body.styleCategory : null,
      });
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
