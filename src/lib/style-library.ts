import { createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse, stripMarkdownFences } from "@/lib/llm";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import type { PostSpec } from "@/lib/post-designer";

/**
 * The Style Library: the agency's proven jewellery looks, one JSON per old
 * design, grouped into four categories. Extraction runs on the cheap vision
 * model with ONE locked schema so every preset comes out with identical
 * fields — the whole reason this lives here instead of ad-hoc ChatGPT chats.
 */

export const STYLE_CATEGORIES = ["traditional", "modern", "surreal", "boutique"] as const;

export interface StylePrompt {
  category?: string;
  subject?: string;
  tags?: string[];
  shot_type?: string;
  occasion?: string;
  lighting?: string;
  camera?: string;
  composition?: string;
  background?: string;
  props?: string;
  material_rendering?: string;
  color_palette?: string;
  mood?: string;
  finish?: string;
  text_space?: string;
  human_elements?: string;
  avoid?: string[];
  type_style?: string;
  type_reference?: string;
  type_weight?: string;
  type_case?: string;
  letter_spacing?: string;
  text_treatment?: string;
  text_hierarchy?: string;
  script_language?: string;
}

const EXTRACT_SYSTEM = `You are a senior art director at an Indian advertising agency that serves jewellery brands. You reverse-engineer finished ad designs into precise, reusable style specifications. You answer ONLY with JSON.`;

const EXTRACT_PROMPT = `Study this finished jewellery ad design and extract its visual style as JSON so a different piece of jewellery could be shot/generated in EXACTLY this look.

Return ONLY a JSON object with these fields (omit a field only if truly not determinable):
{
  "category": "traditional | modern | surreal | boutique — which of this agency's four style shelves the design belongs on:
    traditional = heritage Indian look: temple/festive warmth, silk drapes, diyas, deep maroons and golds, ornate;
    modern = clean contemporary: minimal props, generous white/neutral space, crisp light, geometric simplicity;
    surreal = dreamlike or conceptual: impossible scenes, floating elements, fantasy scale, painterly skies;
    boutique = intimate luxury editorial: moody close-ups, rich shadows, premium magazine feel, quiet opulence",
  "subject": "what the piece is, e.g. 'bridal kundan necklace set'",
  "tags": ["necklace|ring|earrings|bangle|bracelet|pendant|mangalsutra|bridal-set|chain", "bridal|festive|daily-wear|gifting", "model-shot|product-only|flat-lay|lifestyle", "...any other useful tag"],
  "shot_type": "product-only | model-wearing | flat-lay | lifestyle",
  "occasion": "wedding | festival | daily-wear | gifting | offer",
  "lighting": "direction, warmth, hardness, ambience — be specific",
  "camera": "focal feel, angle, depth of field",
  "composition": "placement, fill %, negative space, where the eye goes",
  "background": "surfaces, drapes, colour, bokeh, setting",
  "props": "what props and how minimal/styled",
  "material_rendering": "how metal and stones are rendered — specularity, polish, glow",
  "color_palette": "dominant + accent colours",
  "mood": "3-4 words, e.g. regal, heritage, intimate",
  "finish": "editorial / e-commerce clean / film grain / matte etc.",
  "text_space": "where the layout leaves clean room for text",
  "human_elements": "none | hands only | full model — with styling notes",
  "avoid": ["things this style never does"],
  "type_style": "high-contrast serif | modern sans | script-calligraphy | display-decorative",
  "type_reference": "a well-known look-alike font family, e.g. 'Playfair/Didot-style thin serif'",
  "type_weight": "light | regular | bold",
  "type_case": "ALL CAPS | Title Case | lowercase",
  "letter_spacing": "tight | normal | wide",
  "text_treatment": "gold foil | embossed | plain white | outlined | gradient",
  "text_hierarchy": "e.g. small kicker top, large headline centre, price bottom-right",
  "script_language": "English | Hindi | Gujarati | mixed"
}

Describe what IS in this design, never what could be. No markdown, JSON only.`;

/**
 * Extract style JSON for up to `limit` pending presets. Called repeatedly from
 * the UI until nothing is pending — same shape as the caption backfill, so a
 * 50-file upload never has to survive a single request.
 */
export async function extractPendingPresets(limit = 5): Promise<{ done: number; failed: number; remaining: number }> {
  const admin = createServiceRoleClient();
  const { data: pending } = await admin
    .from("style_presets")
    .select("id, image_url, file_name, mime, category")
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);

  let done = 0, failed = 0;
  for (const row of pending || []) {
    try {
      const buf = await downloadDriveFileByUrl(row.image_url);
      if (!buf || buf.length === 0) throw new Error("Could not read the file back from Google Drive.");

      const isPdf = (row.mime || "").includes("pdf") || /\.pdf$/i.test(row.file_name || "");
      const base64 = buf.toString("base64");
      const raw = await completeVision({
        purpose: "style-extraction",
        system: EXTRACT_SYSTEM,
        prompt: EXTRACT_PROMPT,
        ...(isPdf
          ? { fileDataUrl: `data:application/pdf;base64,${base64}`, fileName: row.file_name || "design.pdf" }
          : { imageDataUrl: `data:${row.mime || "image/jpeg"};base64,${base64}` }),
        maxTokens: 900,
      });

      const prompt = safeJsonParse<StylePrompt>(stripMarkdownFences(raw), {});
      if (!prompt.lighting && !prompt.composition && !prompt.background) {
        throw new Error("The vision model returned nothing usable for this file.");
      }

      // Where the model would file it — recorded always, decisive only when
      // the upload arrived unsorted. A human's chosen shelf is never moved.
      const suggested = (STYLE_CATEGORIES as readonly string[]).includes(String(prompt.category || "").toLowerCase())
        ? String(prompt.category).toLowerCase()
        : null;
      if (!row.category && !suggested) {
        throw new Error("Auto-sort couldn't decide a category — pick a shelf on the card and retry.");
      }

      await admin.from("style_presets").update({
        prompt,
        subject: prompt.subject || null,
        tags: (prompt.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
        shot_type: prompt.shot_type || null,
        occasion: prompt.occasion || null,
        category: row.category || suggested,
        suggested_category: suggested,
        auto_sorted: !row.category,
        status: "approved", // extracted straight to approved; staff demotes the weak ones
        extract_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      done++;
    } catch (err: unknown) {
      await admin.from("style_presets").update({
        status: "failed",
        extract_error: err instanceof Error ? err.message.slice(0, 300) : "Extraction failed",
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      failed++;
    }
  }

  const { count } = await admin
    .from("style_presets")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  return { done, failed, remaining: count || 0 };
}

/**
 * The house look, digested from every approved preset — what the founder's
 * chosen references have in common. This is handed to the ART DIRECTOR before
 * any post is designed. The style block below already steered the image model,
 * but by then the design was committed: when the director briefed "pure black
 * typographic slides", no exemplar shown afterwards could un-choose the black.
 * The library the founder curated has to be in the room when the choosing
 * happens, not after.
 */
export async function houseLookDigest(category?: string | null, clientId?: string | null): Promise<string> {
  const admin = createServiceRoleClient();
  const fetchRows = async (opts: { client?: string | null; category?: string | null }) => {
    let q = admin.from("style_presets").select("starred, prompt").eq("status", "approved").limit(200);
    if (opts.client) q = q.eq("client_id", opts.client);
    if (opts.category) q = q.eq("category", opts.category);
    const { data } = await q;
    return (data || []) as { starred: boolean; prompt: StylePrompt | null }[];
  };

  // References uploaded FOR this brand describe this brand. The shared shelf
  // describes every other brand the agency has worked for, which is how a warm
  // floral label was briefed "moody, rich shadows, avoid bright colours".
  let data = clientId ? await fetchRows({ client: clientId, category }) : [];
  if (data.length === 0 && clientId && category) data = await fetchRows({ client: clientId });
  if (data.length === 0) data = await fetchRows({ category });
  // A default category with nothing approved should fall back to the whole
  // library, not to no guidance at all.
  if (data.length === 0 && category) data = await fetchRows({});

  const rows = data
    .filter((r) => r.prompt)
    .sort((a, b) => Number(b.starred) - Number(a.starred));
  if (rows.length === 0) return "";

  // Short phrases (moods, palettes, avoids) are counted across the library so
  // the commonest ones surface; long prose fields are quoted verbatim from the
  // best rows instead, because frequency-splitting a sentence yields confetti.
  const gather = (field: keyof StylePrompt, top = 6): string => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const v = r.prompt![field];
      const items = Array.isArray(v) ? v : v ? [String(v)] : [];
      for (const item of items) {
        for (const part of String(item).split(/[,;]/)) {
          const s = part.trim().toLowerCase();
          if (s && s.length < 60) seen.set(s, (seen.get(s) || 0) + 1);
        }
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([s]) => s).join(", ");
  };
  const quote = (field: keyof StylePrompt, n: number): string =>
    rows.map((r) => r.prompt![field]).filter((v): v is string => typeof v === "string" && !!v).slice(0, n).join(" · ");

  const lines = [
    ["Mood", gather("mood")],
    ["Palette", gather("color_palette")],
    ["Lighting", quote("lighting", 1)],
    ["Backgrounds", quote("background", 2)],
    ["Never", gather("avoid", 8)],
  ].filter(([, v]) => v);
  if (lines.length === 0) return "";

  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** Words worth matching between a plan slot and a preset's tags/subject. */
function keywords(spec: PostSpec): string[] {
  const text = `${spec.scenePrompt} ${spec.headline} ${spec.subtext}`.toLowerCase();
  const JEWELLERY = ["necklace", "ring", "earring", "bangle", "bracelet", "pendant", "mangalsutra", "chain", "bridal", "kundan", "polki", "diamond", "gold", "silver", "wedding", "festival", "festive", "gift", "offer", "daily"];
  return JEWELLERY.filter((w) => text.includes(w));
}

interface PresetRow { subject: string | null; tags: string[]; starred: boolean; prompt: StylePrompt }

function scorePreset(p: PresetRow, kws: string[]): number {
  let score = p.starred ? 2 : 0;
  const hay = `${p.subject || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
  for (const k of kws) if (hay.includes(k)) score += 1;
  return score;
}

/**
 * The style block appended to a generated post's scene prompt: the best 2
 * approved exemplars from the chosen category, merged (best match wins a
 * field, the runner-up fills its gaps). Returns "" when the category has
 * nothing approved, so 5b degrades to exactly its old behaviour.
 */
export async function styleBlockFor(spec: PostSpec, category: string, clientId?: string | null): Promise<string> {
  if (!category) return "";
  const admin = createServiceRoleClient();
  const fetchRows = async (client?: string | null) => {
    let q = admin
      .from("style_presets")
      .select("subject, tags, starred, prompt")
      .eq("category", category)
      .eq("status", "approved")
      .limit(200);
    if (client) q = q.eq("client_id", client);
    const { data } = await q;
    return (data || []) as PresetRow[];
  };

  // This brand's own approved references win outright; the shared shelf is the
  // fallback, not the default.
  const ownRows = clientId ? await fetchRows(clientId) : [];
  const rows = ownRows.length > 0 ? ownRows : await fetchRows();
  if (rows.length === 0) return "";

  const kws = keywords(spec);
  const ranked = rows.map((p) => ({ p, s: scorePreset(p, kws) })).sort((a, b) => b.s - a.s);
  const top = ranked.slice(0, 2).map((r) => r.p.prompt);

  const pick = (field: keyof StylePrompt): string => {
    for (const t of top) {
      const v = t[field];
      if (Array.isArray(v) ? v.length : v) return Array.isArray(v) ? v.join(", ") : String(v);
    }
    return "";
  };

  const lines = [
    ["Lighting", pick("lighting")],
    ["Camera", pick("camera")],
    ["Composition", pick("composition")],
    ["Background", pick("background")],
    ["Props", pick("props")],
    ["Material rendering", pick("material_rendering")],
    ["Colour palette", pick("color_palette")],
    ["Mood", pick("mood")],
    ["Finish", pick("finish")],
    ["Never", pick("avoid")],
  ].filter(([, v]) => v);
  if (lines.length === 0) return "";

  const source = ownRows.length > 0 ? "this brand's own approved references" : "this agency's proven designs";
  return `\nSTYLE REFERENCE — "${category}" (from ${source}; follow this visual language exactly):\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}`;
}
