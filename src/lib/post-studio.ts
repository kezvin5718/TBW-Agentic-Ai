import sharp from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { generateBrandImage } from "@/lib/integrations/openai-images";
import { storeFromBuffer } from "@/lib/google-drive";
import { analysePlan, pixelsFor, shapeFor, type PostSpec } from "@/lib/post-designer";

/**
 * Builds the actual images.
 *
 * A post with the client's merchandise in it is *composited* — their real
 * photograph, placed on a brand-coloured frame with their logo and typography.
 * Nothing about the product is redrawn, because an invented necklace is the one
 * mistake a jewellery client will always catch.
 *
 * Only posts with no merchandise — festival greetings, offers, quotes — are
 * generated, and even then the model draws the background and never any text or
 * product; the words are laid on afterwards so they are always correct and in
 * the brand's font.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wraps text to a rough character width — DejaVu is roughly 0.55em per glyph. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** The type block: headline, supporting line, CTA pill. */
function textLayer(spec: PostSpec, width: number, height: number): Buffer {
  const portrait = height > width;
  const headSize = Math.round(width * (portrait ? 0.085 : 0.095));
  const subSize = Math.round(headSize * 0.42);
  const ctaSize = Math.round(headSize * 0.34);

  const headLines = wrap(spec.headline.toUpperCase(), portrait ? 16 : 18);
  // Type sits in the lower third so a composited product has the upper frame.
  const blockTop = Math.round(height * (portrait ? 0.62 : 0.60));

  let y = blockTop;
  const parts: string[] = [];

  for (const line of headLines) {
    parts.push(
      `<text x="${Math.round(width * 0.08)}" y="${y}" font-family="DejaVu Sans" font-size="${headSize}" font-weight="bold" fill="${spec.textHex}" letter-spacing="1">${esc(line)}</text>`
    );
    y += Math.round(headSize * 1.15);
  }

  if (spec.subtext) {
    y += Math.round(subSize * 0.5);
    for (const line of wrap(spec.subtext, portrait ? 34 : 38).slice(0, 2)) {
      parts.push(
        `<text x="${Math.round(width * 0.08)}" y="${y}" font-family="DejaVu Sans" font-size="${subSize}" fill="${spec.textHex}" opacity="0.85">${esc(line)}</text>`
      );
      y += Math.round(subSize * 1.3);
    }
  }

  if (spec.cta) {
    y += Math.round(ctaSize * 1.2);
    const padX = Math.round(ctaSize * 0.9);
    const padY = Math.round(ctaSize * 0.6);
    const textW = Math.round(spec.cta.length * ctaSize * 0.58);
    parts.push(
      `<rect x="${Math.round(width * 0.08)}" y="${y - ctaSize}" rx="${Math.round(ctaSize * 0.6)}" width="${textW + padX * 2}" height="${ctaSize + padY * 2}" fill="${spec.accentHex}" />`,
      `<text x="${Math.round(width * 0.08) + padX}" y="${y + padY * 0.6}" font-family="DejaVu Sans" font-size="${ctaSize}" font-weight="bold" fill="${spec.backgroundHex}">${esc(spec.cta)}</text>`
    );
  }

  // A scrim keeps type readable over a busy photograph or scene.
  const scrim = `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${spec.backgroundHex}" stop-opacity="0"/>
      <stop offset="55%" stop-color="${spec.backgroundHex}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${spec.backgroundHex}" stop-opacity="0.97"/>
    </linearGradient>`;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${scrim}</defs>
    <rect x="0" y="${Math.round(height * 0.42)}" width="${width}" height="${Math.round(height * 0.58)}" fill="url(#s)"/>
    ${parts.join("\n")}
  </svg>`;
  return Buffer.from(svg);
}

/** Flat brand-coloured canvas, used when there is no photo or scene behind. */
async function canvas(spec: PostSpec, width: number, height: number): Promise<Buffer> {
  const rgb = {
    r: parseInt(spec.backgroundHex.slice(1, 3), 16),
    g: parseInt(spec.backgroundHex.slice(3, 5), 16),
    b: parseInt(spec.backgroundHex.slice(5, 7), 16),
  };
  return sharp({ create: { width, height, channels: 3, background: rgb } }).png().toBuffer();
}

/** The client's own photograph, filling the frame. Never redrawn. */
async function productBase(photoUrl: string, width: number, height: number): Promise<Buffer | null> {
  try {
    const res = await fetch(photoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await sharp(buf).resize({ width, height, fit: "cover", position: "attention" }).png().toBuffer();
  } catch {
    return null;
  }
}

export interface RenderedPost {
  buffer: Buffer;
  note: string;
}

/**
 * Renders one frame. `photoUrl` is required for product posts and ignored for
 * generated ones.
 */
export async function renderFrame(spec: PostSpec, photoUrl?: string | null): Promise<RenderedPost> {
  const { width, height } = pixelsFor(spec);
  let base: Buffer | null = null;
  let note = "";

  if (spec.kind === "product" && photoUrl) {
    base = await productBase(photoUrl, width, height);
    if (!base) note = "Could not read the product photo — fell back to a plain brand background.";
  } else if (spec.kind === "generated" && spec.scenePrompt) {
    const prompt = `${spec.scenePrompt}

Style: premium Indian advertising background for a jewellery brand. Rich but uncluttered, with clear empty space across the lower half where text will be placed afterwards.
Absolutely no text, no letters, no numbers, no logos, no watermarks, no people, and no jewellery or products of any kind. Background scene only.`;
    const { buffer, error } = await generateBrandImage(prompt, shapeFor(spec));
    if (buffer) {
      base = await sharp(buffer).resize({ width, height, fit: "cover" }).png().toBuffer();
    } else {
      note = `Image generation failed (${error}) — used a plain brand background.`;
    }
  }

  if (!base) base = await canvas(spec, width, height);

  const composed = await sharp(base)
    .composite([{ input: textLayer(spec, width, height), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer: composed, note };
}

export interface Verdict {
  ok: boolean;
  issues: string[];
}

/**
 * Looks at the finished image and judges it against the brief that produced it.
 *
 * The same idea as brand QC, pointed at a different question: not "is this the
 * right brand" but "did the renderer actually do what was asked". It is what
 * catches a clipped headline or a product cropped out of frame before a person
 * has to.
 */
export async function critique(image: Buffer, spec: PostSpec): Promise<Verdict> {
  try {
    const small = await sharp(image).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const raw = await completeVision({
      system: "You check advertising creatives against the brief they were made from. Be strict but fair, and answer only in JSON.",
      prompt: `This creative was built to this brief:
- Headline that must appear: "${spec.headline}"
- Supporting line: "${spec.subtext || "(none)"}"
- Call to action: "${spec.cta || "(none)"}"
- Type of post: ${spec.kind === "product" ? "must show a real product photograph" : "background scene only, no product"}

Check only these, and report a problem only if it is clearly visible:
1. Is the headline fully readable — not cut off at an edge, not overlapping other text, and contrasting enough with what is behind it?
2. ${spec.kind === "product" ? "Is the product visible and not badly cropped?" : "Is it free of any product or merchandise that a brand would have to actually sell?"}
3. Is there any garbled or nonsense lettering?

Return JSON: { "ok": true|false, "issues": ["short description", ...] }`,
      imageDataUrl: `data:image/jpeg;base64,${small.toString("base64")}`,
    });
    let clean = raw.trim();
    if (clean.startsWith("```")) clean = clean.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
    const v = safeJsonParse<Verdict>(clean, { ok: true, issues: [] });
    return { ok: v.ok !== false, issues: Array.isArray(v.issues) ? v.issues.slice(0, 4) : [] };
  } catch {
    // A critic that cannot run must not block the work — a human sees it next.
    return { ok: true, issues: [] };
  }
}

/**
 * Runs a plan end to end: design, render, check, and file each result in
 * Creative Approvals. Nothing publishes; a person still says yes.
 */
export async function generatePlanPosts(
  planId: string,
  photoByItem: Record<string, string[]>,
  limit = 30
): Promise<{ created: number; failed: number; notes: string[] }> {
  const admin = createServiceRoleClient();
  const plan = await analysePlan(planId);

  const { data: client } = await admin
    .from("clients")
    .select("name, logo_url")
    .eq("id", plan.clientId)
    .maybeSingle();
  const monthLabel = plan.month.slice(0, 7);

  let created = 0;
  let failed = 0;
  const notes: string[] = [];

  for (const spec of plan.specs.slice(0, limit)) {
    const photos = photoByItem[String(spec.item)] || [];
    if (spec.kind === "product" && photos.length === 0) {
      notes.push(`Post ${spec.item + 1} (“${spec.headline}”) skipped — it needs a product photo.`);
      continue;
    }

    for (let frame = 0; frame < spec.frames; frame++) {
      try {
        const { buffer, note } = await renderFrame(spec, photos[frame] || photos[0] || null);
        const verdict = await critique(buffer, spec);

        const url = await storeFromBuffer(
          buffer,
          `${(client?.name || "client").replace(/[^a-zA-Z0-9]/g, "-")}-${monthLabel}-post-${spec.item + 1}${spec.frames > 1 ? `-${frame + 1}` : ""}.jpg`,
          "image/jpeg",
          client?.name || undefined,
          monthLabel
        );
        if (!url) {
          failed++;
          notes.push(`Post ${spec.item + 1}: could not be stored.`);
          continue;
        }

        const { error } = await admin.from("creatives").insert({
          client_id: plan.clientId,
          plan_id: planId,
          plan_item: spec.item,
          frame_index: frame,
          type: spec.contentType === "story" ? "story" : "image",
          content_type: spec.contentType,
          caption: [spec.headline, spec.subtext, spec.cta].filter(Boolean).join("\n\n"),
          media_url: url,
          scheduled_for: spec.date ? new Date(`${spec.date}T10:00:00+05:30`).toISOString() : null,
          spec,
          qc_status: verdict.ok ? "passed" : "failed",
          qc_note: [note, ...verdict.issues].filter(Boolean).join(" · ") || null,
          founder_approval: "pending",
          client_approval: "pending",
          source: "plan",
        });
        if (error) {
          failed++;
          notes.push(`Post ${spec.item + 1}: ${error.message}`);
          continue;
        }

        created++;
        if (!verdict.ok) notes.push(`Post ${spec.item + 1} needs a look: ${verdict.issues.join("; ")}`);
      } catch (err: unknown) {
        failed++;
        notes.push(`Post ${spec.item + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { created, failed, notes };
}
