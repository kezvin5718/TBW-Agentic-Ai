import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { houseLookDigest } from "@/lib/style-library";

/**
 * Reads a monthly plan and decides how each post should be made.
 *
 * The director never draws. It turns a calendar row into a filled-in brief —
 * layout, headline, which brand colour does what, where the product sits — and
 * the renderer follows that brief exactly. That split is what makes twenty
 * posts look like one set: an LLM writing a fresh prompt each time is precisely
 * what produces twenty posts that don't match.
 */

/** A row as Campaign Planning stores it. */
export interface PlanItem {
  date?: string;
  format?: string;
  platform?: string;
  concept?: string;
  hook?: string;
  CTA?: string;
  /** Everything below is the plan author's own words, carried from import. */
  time?: string;
  caption?: string;
  slideCopy?: string[];
  /** The author's art direction for this post. Binding, not advisory. */
  productionNote?: string;
  hashtags?: string;
  complianceNote?: string;
}

export type PostKind = "product" | "generated";

export interface PostSpec {
  /** Index of the item in the plan's content_calendar. */
  item: number;
  date: string | null;
  platform: string;
  /** post | story | carousel — what Social Publisher will treat it as. */
  contentType: string;
  /** Does this need a real photograph of the client's product? */
  kind: PostKind;
  /** Frames to produce. 1 for a static post, 3–5 for a carousel. */
  frames: number;
  headline: string;
  subtext: string;
  cta: string;
  /** Which brand colour is the background, and which the accent. */
  backgroundHex: string;
  accentHex: string;
  textHex: string;
  /** For generated posts only — the scene, never containing a real product. */
  scenePrompt: string;
  /**
   * One line per carousel frame, in order, taken from the plan's own slide copy.
   * Without this a carousel repeated the cover's headline and the author's
   * numbered slides were never drawn at all.
   */
  slideCopy?: string[];
  /** Why this was classed as it was, shown to the reviewer. */
  reason: string;
}

const SQUARE_PLATFORMS = ["instagram", "facebook", "linkedin", "pinterest"];

/** 9:16 for stories, 1:1 for everything else. */
export function shapeFor(spec: PostSpec): "square" | "portrait" {
  return spec.contentType === "story" ? "portrait" : "square";
}

export function pixelsFor(spec: PostSpec): { width: number; height: number } {
  return shapeFor(spec) === "portrait" ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 };
}

function normaliseType(format?: string, platform?: string): string {
  const f = (format || "").toLowerCase();
  if (f.includes("story")) return "story";
  if (f.includes("carousel")) return "carousel";
  if (f.includes("reel") || f.includes("video")) return "reel";
  if (!SQUARE_PLATFORMS.includes((platform || "").toLowerCase())) return "post";
  return "post";
}

/**
 * What a plan needs before anything can be made.
 *
 * Reels are excluded outright — this pipeline makes stills, and quietly
 * producing a static image for a row that asked for video would be a lie the
 * reviewer has to catch.
 */
export async function analysePlan(planId: string, styleOverride?: string | null): Promise<{
  clientId: string;
  clientName: string;
  month: string;
  total: number;
  needPhoto: number;
  photosRequired: number;
  generated: number;
  skippedReels: number;
  /** The style this plan was designed under — caller's pick, else the plan's import-time choice, else the client default. 5b pre-selects it. */
  styleDefault: string | null;
  specs: PostSpec[];
}> {
  const admin = createServiceRoleClient();
  const { data: plan } = await admin
    .from("monthly_plans")
    .select("id, client_id, month, content_calendar, strategy_summary, designed_specs, designed_hash, style_category, color_palette, clients(name, default_style_category)")
    .eq("id", planId)
    .single();
  if (!plan) throw new Error("Plan not found.");

  const calendar = (plan.content_calendar as PlanItem[] | null) || [];
  if (calendar.length === 0) throw new Error("This plan has no content calendar yet.");

  const clientName = (plan.clients as { name?: string } | null)?.name || "the client";

  const { data: brain } = await admin
    .from("brand_brain")
    // brand_brief and feedback_log were missing here while the caption writer
    // read both. That is why captions sounded like the brand and creative did
    // not, and why rejecting a creative changed nothing: the only record of the
    // founder's corrections never reached the pipeline that keeps repeating them.
    .select("colors, fonts, caption_tone, design_preferences, brand_brief, feedback_log")
    .eq("client_id", plan.client_id)
    .maybeSingle();

  // Colours the founder fixed for THIS plan at import outrank the brand's
  // recorded palette — this is how one campaign goes warm ivory while the
  // brand card still says black-and-gold, without editing Brand Brain.
  const planColors = (Array.isArray(plan.color_palette) ? (plan.color_palette as unknown[]) : [])
    .filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c));
  const colors = planColors.length > 0 ? planColors : ((brain?.colors as string[] | null) || []).filter(Boolean);

  // What the founder's approved Style Library actually looks like — in the
  // room BEFORE the design is chosen. Without this the director invented
  // "pure black typographic slides" for a warm, soft-lit boutique brand.
  // Resolution order: the caller's explicit pick (5b's dropdown), then the
  // style chosen when the plan was imported, then the client's default.
  const styleDefault =
    styleOverride ||
    (plan.style_category as string | null) ||
    (plan.clients as { default_style_category?: string | null } | null)?.default_style_category ||
    null;
  const houseLook = await houseLookDigest(styleDefault);

  // Reels need footage, not a still — leave them for the video pipeline.
  const usable = calendar
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => normaliseType(item.format, item.platform) !== "reel");
  const skippedReels = calendar.length - usable.length;

  // Designing a month is a paid multi-second model call, and its inputs are
  // fully known: the calendar and the brand brain. Hash them; when nothing
  // changed, the stored design IS the design. This is what lets the page
  // refresh freely — a cache hit is one database read.
  const designHash = fnvHash(JSON.stringify([calendar, colors, brain?.caption_tone, brain?.design_preferences, brain?.brand_brief, brain?.feedback_log, styleDefault, houseLook]));
  const cached = plan.designed_hash === designHash && Array.isArray(plan.designed_specs) ? (plan.designed_specs as PostSpec[]) : null;

  // The founder's last corrections, in their own words. These are the whole
  // reason a rejection is worth making.
  const corrections = Array.isArray(brain?.feedback_log)
    ? (brain!.feedback_log as unknown[])
        .slice(-8)
        .map((f) => (typeof f === "string" ? f : JSON.stringify(f)))
        .join("\n")
    : "";

  const system = `You are an art director at an Indian advertising agency, briefing a designer for "${clientName}".

For each row of the content calendar, produce a brief. You are deciding how a post should be built, not writing it.

Who this brand is:
${String(brain?.brand_brief || "Not recorded.").slice(0, 1500)}

${planColors.length
    ? `COLOURS FIXED FOR THIS PLAN. The founder chose this exact palette when the plan was imported — every backgroundHex, accentHex and textHex you write comes from these codes or harmonises directly with them, and no other palette overrides them: ${planColors.join(", ")}.`
    : `Brand colours available: ${colors.length ? colors.join(", ") : "none recorded — use tasteful neutrals"}.`}
Caption tone: ${brain?.caption_tone || "warm, premium, plain-spoken"}.
${houseLook ? `
THE HOUSE LOOK. The founder has curated a Style Library of approved reference designs, and this is what they have in common:
${houseLook}
Every post you design lives inside this world — its warmth, its light, its palette. A concept can be minimal or bold, festive or quiet, but it is always recognisably this brand's look.` : ""}

Corrections the founder has already given on this brand's work. These outrank your own taste — if one of them contradicts what you were about to do, they win:
${corrections || "None recorded yet."}

THE MOST IMPORTANT RULE. Some rows carry a "productionNote" — the art direction the plan's author already wrote. Its explicit words bind you: its prohibitions ("no logo", "no product", "no faces") are absolute, and if it names a colour or a treatment, that is the colour and the treatment. But do not ADD austerity it never asked for. "Typographic" or "minimal imagery" means the type carries the message on a quiet, textured backdrop in the house look — it does not mean a flat black void. Where the note is silent on colour, texture or light, the house look decides. Where a row has a "hook", those are the author's words for the big line — keep them unless they physically cannot fit.

Classify each post as one of:
- "product" — the post shows the client's actual merchandise. Anything described as a product showcase, a collection, a new arrival, a piece of jewellery.
- "generated" — no real merchandise is needed. Festival greetings, offers and discounts, quotes, tips, store announcements, hiring posts.

Be conservative: if a post could plausibly need a real product photograph, call it "product". Inventing jewellery that the client does not sell is the one unacceptable outcome.

Rules:
- headline: 3-7 words, the words that go large on the image. No hashtags, no emoji. If the row has a "hook", that IS the headline — trim it to fit rather than rewriting it into something blander.
- subtext: one short supporting line, or an empty string. Draw it from the row's caption or slide copy where there is one; do not invent a new claim.
- cta: short, from the row's CTA if it has one.
- scenePrompt must follow the row's productionNote wherever one exists, including its prohibitions ("no logo", "no product", "no faces").
- backgroundHex / accentHex / textHex: real hex codes. Use the brand colours and the house palette; make sure text contrasts strongly with the background. Never #000000 unless the productionNote itself demands black.
- scenePrompt: only for "generated" posts — describe the background scene, surfaces, lighting and mood, in the house look. It is a photograph of a place or a surface, NEVER a layout: no slides, no text, no typography, no statistics, no numbers, no lettering of any kind — every word is set on top afterwards by the compositor, and any text the image model draws comes out garbled and gets the post rejected. Empty string for "product" posts.
- frames: 1, except a carousel which is 3 to 5.`;

  const prompt = `Client: ${clientName}
Plan month: ${plan.month}
Strategy: ${plan.strategy_summary || "not recorded"}

Calendar rows:
${usable
  .map(({ item, i }) => {
    const lines = [
      `--- Row ${i} · ${item.date || "no date"} · ${item.format || "static"} · ${item.platform || "instagram"}`,
      `Concept: ${item.concept || "(none)"}`,
    ];
    if (item.hook) lines.push(`Author's line (use this as the headline): ${item.hook}`);
    if (item.productionNote) lines.push(`ART DIRECTION — FOLLOW THIS: ${item.productionNote}`);
    if (item.slideCopy?.length) lines.push(`Slide copy: ${item.slideCopy.join(" | ")}`);
    if (item.caption) lines.push(`Caption: ${item.caption.replace(/\s+/g, " ").slice(0, 400)}`);
    if (item.CTA) lines.push(`CTA: ${item.CTA}`);
    if (item.complianceNote) lines.push(`COMPLIANCE — do not contradict: ${item.complianceNote.slice(0, 300)}`);
    return lines.join("\n");
  })
  .join("\n")}

Return STRICTLY:
{ "posts": [ { "item": <the index number given above>, "kind": "product" | "generated", "contentType": "post" | "story" | "carousel", "frames": 1, "headline": "...", "subtext": "...", "cta": "...", "backgroundHex": "#RRGGBB", "accentHex": "#RRGGBB", "textHex": "#RRGGBB", "scenePrompt": "...", "reason": "one short line" } ] }`;

  let raw = "";
  if (!cached) {
    raw = await complete({
      purpose: "post-design (5b)",
      model: MODEL_SMART,
      system,
      messages: [{ role: "user", content: prompt }],
      jsonSchema: true,
      // A full month of rows now carries far more per post than it used to;
      // 4000 clipped the JSON mid-array on a long calendar.
      maxTokens: 12000,
    });
  }

  let clean = raw.trim();
  if (clean.startsWith("```")) clean = clean.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const parsed = safeJsonParse<{ posts: Partial<PostSpec>[] }>(clean, { posts: [] });

  if (cached) {
    const needPhotoC = cached.filter((s) => s.kind === "product").length;
    return {
      clientId: plan.client_id as string,
      clientName,
      month: String(plan.month),
      total: cached.length,
      needPhoto: needPhotoC,
      photosRequired: cached.filter((s) => s.kind === "product").reduce((n, s) => n + s.frames, 0),
      generated: cached.length - needPhotoC,
      skippedReels,
      styleDefault,
      specs: cached,
    };
  }

  const specs: PostSpec[] = [];
  for (const { item, i } of usable) {
    const got = (parsed.posts || []).find((p) => Number(p.item) === i);
    const contentType = normaliseType(String(got?.contentType || item.format), item.platform);
    // The author's own slides decide how many frames there are. Asking the model
    // for a count while five numbered slides sat in the plan produced three
    // frames and quietly dropped two of them.
    const slideCopy = (item.slideCopy || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    const frames =
      contentType !== "carousel" ? 1
      : slideCopy.length >= 2 ? slideCopy.length
      : Math.min(5, Math.max(3, Number(got?.frames) || 3));
    specs.push({
      item: i,
      date: item.date || null,
      platform: (item.platform || "instagram").toLowerCase(),
      contentType,
      // Absent a clear answer, assume it needs a real photo. The failure that
      // matters is inventing a product, not asking for a picture we didn't need.
      kind: got?.kind === "generated" ? "generated" : "product",
      frames,
      headline: String(got?.headline || item.concept || "").slice(0, 80),
      subtext: String(got?.subtext || "").slice(0, 120),
      cta: String(got?.cta || item.CTA || "").slice(0, 60),
      backgroundHex: hexOr(got?.backgroundHex, colors[0] || "#1c1917"),
      accentHex: hexOr(got?.accentHex, colors[1] || "#d4af37"),
      textHex: hexOr(got?.textHex, "#ffffff"),
      scenePrompt: String(got?.scenePrompt || ""),
      slideCopy,
      reason: String(got?.reason || ""),
    });
  }

  // Remember this design until the calendar or the brand brain changes.
  await admin.from("monthly_plans").update({ designed_specs: specs, designed_hash: designHash }).eq("id", planId);

  const needPhoto = specs.filter((s) => s.kind === "product").length;
  const photosRequired = specs.filter((s) => s.kind === "product").reduce((n, s) => n + s.frames, 0);

  return {
    clientId: plan.client_id as string,
    clientName,
    month: String(plan.month),
    total: specs.length,
    needPhoto,
    photosRequired,
    generated: specs.length - needPhoto,
    skippedReels,
    styleDefault,
    specs,
  };
}

/** FNV-1a — tiny, stable, good enough to detect "did the inputs change". */
function fnvHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function hexOr(value: unknown, fallback: string): string {
  const s = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}
