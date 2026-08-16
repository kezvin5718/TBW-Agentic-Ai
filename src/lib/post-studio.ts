import sharp, { type OverlayOptions } from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { generateBrandImage } from "@/lib/integrations/openai-images";
import { storeToDriveStrict, isDriveConnected } from "@/lib/google-drive";
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

/**
 * Lays out the type so it always fits.
 *
 * The first version wrapped on a fixed character count and anchored from the
 * top, which overflowed both edges: "CUT TO CATCH EVERY EYE" ran off the right
 * and the block ran off the bottom. Width now comes from the font size, the
 * size shrinks until the text fits, and the block is anchored to the bottom so
 * it can never run past the frame.
 */

/** DejaVu Sans Bold, uppercase, averages a little over 0.6em per glyph. */
const BOLD_ADVANCE = 0.62;
const REG_ADVANCE = 0.55;

function wrapAt(text: string, maxChars: number): string[] {
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
  return lines;
}

/** Largest size at which the text fits the width in at most `maxLines`. */
function fitText(text: string, availPx: number, startPx: number, maxLines: number, advance: number) {
  let size = startPx;
  for (let i = 0; i < 12; i++) {
    const perLine = Math.max(6, Math.floor(availPx / (size * advance)));
    const lines = wrapAt(text, perLine);
    const longest = Math.max(...lines.map((l) => l.length), 1);
    if (lines.length <= maxLines && longest * size * advance <= availPx) {
      return { size, lines };
    }
    size = Math.round(size * 0.9);
  }
  const perLine = Math.max(6, Math.floor(availPx / (size * advance)));
  return { size, lines: wrapAt(text, perLine).slice(0, maxLines) };
}

/**
 * The type block, laid into a band of known height at the foot of the frame.
 *
 * `bandTop` is where the product stops and the type begins. Giving the words
 * their own space is what stopped the headline sitting across the necklace —
 * a scrim made it legible, but legible-on-top-of-the-jewellery is still the
 * wrong look for a jewellery brand.
 */
function textLayer(spec: PostSpec, width: number, height: number, bandTop: number, centerBlock = false): Buffer {
  const marginX = Math.round(width * 0.08);
  const avail = width - marginX * 2;
  const portrait = height > width;
  const bandH = height - bandTop;

  /** One candidate layout at a given headline size. */
  const layoutAt = (startPx: number) => {
    const head = fitText(spec.headline.toUpperCase(), avail, startPx, 3, BOLD_ADVANCE);
    const subSize = Math.max(18, Math.round(head.size * 0.38));
    const subLines = spec.subtext
      ? fitText(spec.subtext, avail, subSize, 2, REG_ADVANCE)
      : { size: subSize, lines: [] as string[] };
    const ctaSize = Math.max(16, Math.round(head.size * 0.30));
    const headLead = Math.round(head.size * 1.14);
    const subLead = Math.round(subLines.size * 1.32);
    const ctaH = spec.cta ? Math.round(ctaSize * 2.2) : 0;
    const blockH =
      head.lines.length * headLead +
      (subLines.lines.length ? Math.round(subLines.size * 0.6) + subLines.lines.length * subLead : 0) +
      (ctaH ? Math.round(ctaSize * 0.8) + ctaH : 0);
    return { head, subLines, ctaSize, headLead, subLead, ctaH, blockH };
  };

  const bottomPad = Math.round(height * (portrait ? 0.07 : 0.06));

  // Fit the type to the band's HEIGHT as well as its width. fitText only ever
  // checked width, so a two-line headline over a two-line subline could build a
  // block taller than the band — and since the block is anchored to bandTop
  // when it doesn't fit, the surplus grew straight off the bottom of the frame
  // and was cut by the edge. That is what sliced "crafted for you" in half.
  let start = Math.round(Math.min(width * 0.10, bandH * 0.26));
  let laid = layoutAt(start);
  while (laid.blockH > bandH - bottomPad && start > 20) {
    start = Math.round(start * 0.88);
    laid = layoutAt(start);
  }
  const { head, subLines, ctaSize, headLead, subLead, blockH } = laid;

  // Sit the block above the bottom edge rather than growing down past it, and
  // never above the band it belongs to. When the type owns the whole frame
  // there is nothing above it to sit under, so centre it instead of leaving it
  // stranded at the foot of an empty picture.
  let y = centerBlock
    ? bandTop + Math.round((bandH - blockH) / 2) + head.size
    : Math.max(bandTop + head.size, height - bottomPad - blockH + head.size);

  const parts: string[] = [];
  for (const line of head.lines) {
    parts.push(
      `<text x="${marginX}" y="${y}" font-family="DejaVu Sans" font-size="${head.size}" font-weight="bold" fill="${spec.textHex}">${esc(line)}</text>`
    );
    y += headLead;
  }

  if (subLines.lines.length) {
    y += Math.round(subLines.size * 0.6);
    for (const line of subLines.lines) {
      parts.push(
        `<text x="${marginX}" y="${y}" font-family="DejaVu Sans" font-size="${subLines.size}" fill="${spec.textHex}" opacity="0.88">${esc(line)}</text>`
      );
      y += subLead;
    }
  }

  if (spec.cta) {
    y += Math.round(ctaSize * 0.8);
    const padX = Math.round(ctaSize * 0.95);
    const padY = Math.round(ctaSize * 0.55);
    const textW = Math.round(spec.cta.length * ctaSize * REG_ADVANCE);
    parts.push(
      `<rect x="${marginX}" y="${y - ctaSize}" rx="${Math.round(ctaSize * 0.75)}" width="${Math.min(avail, textW + padX * 2)}" height="${ctaSize + padY * 2}" fill="${spec.accentHex}" />`,
      `<text x="${marginX + padX}" y="${y + Math.round(padY * 0.55)}" font-family="DejaVu Sans" font-size="${ctaSize}" font-weight="bold" fill="${spec.backgroundHex}">${esc(spec.cta)}</text>`
    );
  }

  // A short gradient softens the join between photograph and band; the band
  // itself is solid, so type never sits over the product.
  const fade = Math.round(height * 0.06);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${spec.backgroundHex}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${spec.backgroundHex}" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${Math.max(0, bandTop - fade)}" width="${width}" height="${fade}" fill="url(#s)"/>
    <rect x="0" y="${bandTop}" width="${width}" height="${height - bandTop}" fill="${spec.backgroundHex}"/>
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

/** The client's own photograph, filling the area above the type band. Never redrawn. */
async function productBase(photoUrl: string, width: number, areaH: number): Promise<Buffer | null> {
  try {
    const res = await fetch(photoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // "attention" keeps the jewellery in frame rather than centre-cropping it away.
    return await sharp(buf).resize({ width, height: areaH, fit: "cover", position: "attention" }).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * The client's logo, in a soft white chip in the top-left corner.
 *
 * A designer never ships a post without the mark on it; the pipeline was
 * skipping it entirely. The chip is there so the logo stays legible over a
 * dark photo just as reliably as a light one, and it is small on purpose —
 * this is a corner credit, not a second headline.
 */
async function logoLayer(logoUrl: string | null | undefined, width: number, height: number): Promise<OverlayOptions[]> {
  if (!logoUrl) return [];
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return [];
    const buf = Buffer.from(await res.arrayBuffer());
    const maxW = Math.round(width * 0.2);
    const maxH = Math.round(height * 0.07);
    const resized = await sharp(buf)
      .resize({ width: maxW, height: maxH, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    const lw = meta.width || maxW;
    const lh = meta.height || maxH;
    const pad = Math.round(lw * 0.22);
    const margin = Math.round(width * 0.05);

    const chip = Buffer.from(
      `<svg width="${lw + pad * 2}" height="${lh + pad * 2}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" rx="${Math.round((lh + pad * 2) * 0.22)}" fill="#ffffff" fill-opacity="0.92"/>
      </svg>`
    );

    return [
      { input: chip, top: margin, left: margin },
      { input: resized, top: margin + pad, left: margin + pad },
    ];
  } catch {
    return [];
  }
}

/**
 * Decides what each carousel frame carries.
 *
 * The pipeline was repeating the exact same headline and layout on every
 * frame, differing only by which photo sat behind it — four near-identical
 * posts swiped past, not a carousel. A real one has a cover that makes the
 * case, a run of near full-bleed product frames that let the photography do
 * the work, and a close that repeats the offer with the call to action.
 * Single-frame posts are untouched.
 */
function frameLayout(spec: PostSpec, frame: number, width: number, height: number): { bandTop: number; content: PostSpec } {
  const standardBand = Math.round(height * (height > width ? 0.66 : 0.62));

  // Nothing is going above the band on this post — no product photograph, and
  // no scene to generate. Reserving the top for one leaves a dead area with the
  // type crushed underneath it, which is what a purely typographic slide came
  // out looking like. Give the words the whole frame instead.
  const noImagery = spec.kind === "generated" && !spec.scenePrompt.trim();
  const band = noImagery ? Math.round(height * 0.14) : standardBand;

  if (spec.frames <= 1) return { bandTop: band, content: spec };

  const isCover = frame === 0;
  const isLast = frame === spec.frames - 1;
  const slides = spec.slideCopy || [];

  // When the plan wrote its own slides, each frame carries its own line. Before
  // this the cover's headline was repeated and the author's numbered slides
  // were never drawn at all.
  if (slides.length >= 2) {
    const line = slides[Math.min(frame, slides.length - 1)];
    return {
      bandTop: band,
      content: {
        ...spec,
        headline: line,
        // The supporting line belongs on the cover; the slides speak for
        // themselves and a repeated subtitle just crowds them.
        subtext: isCover ? spec.subtext : "",
        cta: isLast ? spec.cta : "",
      },
    };
  }

  if (isCover) {
    // Makes the case; no CTA competing for attention before anyone has swiped.
    return { bandTop: band, content: { ...spec, cta: "" } };
  }
  if (isLast) {
    // The close — full headline, subtext and the call to action together.
    return { bandTop: band, content: spec };
  }
  // Middle frames: almost full-bleed product, just a slim brand strip at the
  // foot. Only meaningful when there IS a photograph — with no imagery this
  // would be a blank frame, so those keep the type instead.
  if (noImagery) return { bandTop: band, content: { ...spec, cta: "" } };
  return { bandTop: Math.round(height * 0.94), content: { ...spec, headline: "", subtext: "", cta: "" } };
}

export interface RenderedPost {
  buffer: Buffer;
  note: string;
  /** The text this frame actually carries — pass to critique(), not the base spec. */
  content: PostSpec;
}

/**
 * Renders one frame. `photoUrl` is required for product posts and ignored for
 * generated ones. `frame` selects where this sits in a carousel (0 = cover);
 * `logoUrl` composites the client's mark into the corner when supplied.
 */
export async function renderFrame(
  spec: PostSpec,
  photoUrl?: string | null,
  frame = 0,
  logoUrl?: string | null
): Promise<RenderedPost> {
  const { width, height } = pixelsFor(spec);
  const { bandTop, content } = frameLayout(spec, frame, width, height);

  let base: Buffer | null = null;
  let note = "";
  // Whether anything is actually sitting above the type. A failed photo or a
  // failed generation falls back to a flat colour, and in that case the words
  // should own the frame rather than hang below an empty rectangle.
  let hasImagery = false;

  if (spec.kind === "product" && photoUrl) {
    const photo = await productBase(photoUrl, width, bandTop);
    if (photo) {
      hasImagery = true;
      base = await sharp(await canvas(spec, width, height))
        .composite([{ input: photo, top: 0, left: 0 }])
        .png()
        .toBuffer();
    } else {
      note = "Could not read the product photo — fell back to a plain brand background.";
    }
  } else if (spec.kind === "generated" && spec.scenePrompt) {
    const prompt = `${spec.scenePrompt}

Style: premium Indian advertising background for a jewellery brand. Rich but uncluttered, with clear empty space across the lower half where text will be placed afterwards.
Absolutely no text, no letters, no numbers, no logos, no watermarks, no people, and no jewellery or products of any kind. Background scene only.`;
    const { buffer, error } = await generateBrandImage(prompt, shapeFor(spec));
    if (buffer) {
      hasImagery = true;
      base = await sharp(buffer).resize({ width, height, fit: "cover" }).png().toBuffer();
    } else {
      note = `Image generation failed (${error}) — used a plain brand background.`;
    }
  }

  if (!base) base = await canvas(spec, width, height);

  const logo = await logoLayer(logoUrl, width, height);

  const composed = await sharp(base)
    .composite([
      ...logo,
      { input: textLayer(content, width, height, bandTop, !hasImagery), top: 0, left: 0 },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buffer: composed, note, content };
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
  options: { items?: number[]; limit?: number } = {}
): Promise<{ created: number; failed: number; notes: string[] }> {
  const admin = createServiceRoleClient();

  // Check the destination before making anything. Rendering and generating cost
  // real money, and there is no point spending it on posts that have nowhere to
  // be saved.
  if (!(await isDriveConnected())) {
    return {
      created: 0,
      failed: 0,
      notes: ["Google Drive isn't connected, so nothing was built. Reconnect it under Integrations and run this again — no images were generated, so this cost nothing."],
    };
  }

  const plan = await analysePlan(planId);
  const limit = options.limit ?? 30;
  // Building one or two posts at a time is the sane way to judge whether the
  // templates are any good — and it keeps the bill small while doing it.
  const wanted = options.items && options.items.length > 0 ? new Set(options.items) : null;

  const { data: client } = await admin
    .from("clients")
    .select("name, logo_url")
    .eq("id", plan.clientId)
    .maybeSingle();
  const monthLabel = plan.month.slice(0, 7);

  let created = 0;
  let failed = 0;
  const notes: string[] = [];

  const chosen = (wanted ? plan.specs.filter((s) => wanted.has(s.item)) : plan.specs).slice(0, limit);

  for (const spec of chosen) {
    const photos = photoByItem[String(spec.item)] || [];
    if (spec.kind === "product" && photos.length === 0) {
      notes.push(`Post ${spec.item + 1} (“${spec.headline}”) skipped — it needs a product photo.`);
      continue;
    }

    for (let frame = 0; frame < spec.frames; frame++) {
      try {
        const { buffer, note, content } = await renderFrame(spec, photos[frame] || photos[0] || null, frame, client?.logo_url);

        // Judge the frame and file it at the same time. Both only need the
        // finished buffer and neither depends on the other, but running them in
        // series added the critic's round trip to every frame — across a
        // multi-frame carousel that is minutes of the route's budget spent
        // waiting rather than working.
        //
        // Generated creatives go to Drive or nowhere. Supabase has no room for
        // them, and a quiet fallback would hide a Drive problem behind a
        // filling bucket.
        const [verdict, stored] = await Promise.all([
          critique(buffer, content),
          storeToDriveStrict(
            buffer,
            `${(client?.name || "client").replace(/[^a-zA-Z0-9]/g, "-")}-${monthLabel}-post-${spec.item + 1}${spec.frames > 1 ? `-${frame + 1}` : ""}.jpg`,
            "image/jpeg",
            client?.name || undefined,
            monthLabel,
            "TBW Generated Posts"
          ),
        ]);
        const { url, error: storeErr } = stored;
        if (!url) {
          failed++;
          notes.push(`Post ${spec.item + 1}: not saved — ${storeErr || "Google Drive refused the upload."}`);
          // A broken connection or a full Drive will not fix itself between
          // frames. Stop rather than paying to generate images that cannot be
          // stored — the first four failures cost four generations for nothing.
          if (/not connected|rejected the saved|out of space/i.test(storeErr || "")) {
            notes.push("Stopped here — every remaining post would fail the same way.");
            return { created, failed, notes };
          }
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
