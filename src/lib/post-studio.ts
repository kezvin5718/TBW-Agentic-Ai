import sharp, { type OverlayOptions } from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { generateBrandImage, IMAGE_TIMEOUT_MS } from "@/lib/integrations/openai-images";
import { storeToDriveStrict, isDriveConnected, downloadDriveFileByUrl } from "@/lib/google-drive";

/** How long any single supporting asset may take before the render gives up. */
const ASSET_TIMEOUT_MS = 30_000;
import { analysePlan, pixelsFor, shapeFor, type PostSpec } from "@/lib/post-designer";
import { styleBlockFor } from "@/lib/style-library";

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

/**
 * Per-glyph advances for DejaVu Sans, as fractions of the font size. A flat
 * average (0.62em bold) measured caps-heavy lines ~20% narrower than they
 * drew, and the surplus ran off the right edge — "DIAMONDS" printed as
 * "DIAMONI". DejaVu's capitals really average ~0.76em bold. These lean
 * slightly wide on purpose: overestimating costs one size step down,
 * underestimating clips letters.
 */
function glyphEm(ch: string, bold: boolean): number {
  if ("MWmw".includes(ch)) return 1.05;
  if ("ijl.,:;'’!| ".includes(ch)) return bold ? 0.40 : 0.34;
  if ("Iftr-()".includes(ch)) return bold ? 0.48 : 0.42;
  if (ch >= "a" && ch <= "z") return bold ? 0.70 : 0.62;
  return bold ? 0.80 : 0.70;
}

/** Width of one line in ems at the given weight. */
function lineEm(text: string, bold: boolean): number {
  let w = 0;
  for (const ch of text) w += glyphEm(ch, bold);
  return w;
}

/** Word-wrap so no line draws wider than availPx at the given size. */
function wrapToWidth(text: string, availPx: number, size: number, bold: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && lineEm(candidate, bold) * size > availPx) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size at which the text fits the width in at most `maxLines`. */
function fitText(text: string, availPx: number, startPx: number, maxLines: number, bold: boolean) {
  let size = startPx;
  for (let i = 0; i < 12; i++) {
    const lines = wrapToWidth(text, availPx, size, bold);
    const widest = Math.max(...lines.map((l) => lineEm(l, bold)), 0) * size;
    if (lines.length <= maxLines && widest <= availPx) {
      return { size, lines };
    }
    size = Math.round(size * 0.9);
  }
  return { size, lines: wrapToWidth(text, availPx, size, bold).slice(0, maxLines) };
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
  // DejaVu Sans bold caps was the only font in the container, so every brand —
  // including the ornate serif ones — came out in the same industrial sans.
  // The CTA pill stays sans: it is a button, not display type. Widths are still
  // measured off the bold-sans table, and serif advances are narrower, so the
  // estimate only ever errs toward a size step down — never toward clipping.
  const display = spec.typeStyle === "serif" ? "Cormorant Garamond, DejaVu Serif" : "DejaVu Sans";
  // An editorial brand centres its axis — mark at the top middle, every line
  // hung off the same centre. Ranging it all left is a magazine sidebar, not
  // the founder's grid. The sans layout is untouched.
  const centred = spec.typeStyle === "serif";
  const marginX = Math.round(width * 0.08);
  const textX = centred ? Math.round(width / 2) : marginX;
  const anchor = centred ? ` text-anchor="middle"` : "";
  const avail = width - marginX * 2;
  const portrait = height > width;
  const bandH = height - bandTop;

  /** One candidate layout at a given headline size. */
  const layoutAt = (startPx: number) => {
    const head = fitText(spec.headline.toUpperCase(), avail, startPx, 3, true);
    const subSize = Math.max(18, Math.round(head.size * 0.38));
    const subLines = spec.subtext
      ? fitText(spec.subtext, avail, subSize, 2, false)
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
      `<text x="${textX}" y="${y}"${anchor} font-family="${display}" font-size="${head.size}" font-weight="bold" fill="${spec.textHex}">${esc(line)}</text>`
    );
    y += headLead;
  }

  if (subLines.lines.length) {
    y += Math.round(subLines.size * 0.6);
    for (const line of subLines.lines) {
      parts.push(
        `<text x="${textX}" y="${y}"${anchor} font-family="${display}" font-size="${subLines.size}" fill="${spec.textHex}" opacity="0.88">${esc(line)}</text>`
      );
      y += subLead;
    }
  }

  if (spec.cta) {
    y += Math.round(ctaSize * 0.8);
    const padX = Math.round(ctaSize * 0.95);
    const padY = Math.round(ctaSize * 0.55);
    const textW = Math.round(lineEm(spec.cta, true) * ctaSize);
    const pillW = Math.min(avail, textW + padX * 2);
    const pillX = centred ? Math.round((width - pillW) / 2) : marginX;
    parts.push(
      `<rect x="${pillX}" y="${y - ctaSize}" rx="${Math.round(ctaSize * 0.75)}" width="${pillW}" height="${ctaSize + padY * 2}" fill="${spec.accentHex}" />`,
      `<text x="${centred ? textX : pillX + padX}" y="${y + Math.round(padY * 0.55)}"${anchor} font-family="DejaVu Sans" font-size="${ctaSize}" font-weight="bold" fill="${spec.backgroundHex}">${esc(spec.cta)}</text>`
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

/**
 * The exact text handed to the image model for a generated post — exported so
 * the 5b screen can show it before any money is spent, and so what is shown is
 * what is sent rather than a paraphrase of it.
 */
export function buildScenePrompt(spec: PostSpec, styleBlock = ""): string {
  // The plan's palette was never spoken to the image model — the compositor put
  // the founder's colours on top of a scene drawn in whatever colours the model
  // liked, which is how a dusty-rose plan came back charcoal.
  const colourWorld = spec.palette?.length
    ? `\nColour world — the scene lives in tints and shades of exactly these: ${spec.palette.join(", ")}. No other colour family may dominate.`
    : "";
  return `${spec.scenePrompt}
${styleBlock}${colourWorld}
Style: premium Indian advertising background for a jewellery brand. Rich but uncluttered, with clear empty space across the lower half where text will be placed afterwards.
Absolutely no text, no letters, no numbers, no logos, no watermarks, no people, and no jewellery or products of any kind. Background scene only.`;
}

/**
 * Fetch an image the pipeline needs, without trusting the host to answer.
 *
 * Product photos and logos live on Google Drive, and Google's CDN does not
 * reliably serve those bytes to a third party — it can simply never respond.
 * A plain untimed fetch therefore hung the render, and because frames are built
 * in sequence the whole batch sat there until the route budget expired. Drive
 * URLs go through the API that is allowed to read them; everything else gets a
 * hard ceiling.
 */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  if (/googleusercontent\.com|drive\.google\.com/.test(url)) {
    try {
      const viaApi = await downloadDriveFileByUrl(url);
      if (viaApi && viaApi.length > 0) return viaApi;
    } catch { /* fall through to a plain, bounded fetch */ }
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The client's own photograph, filling the area above the type band. Never redrawn. */
async function productBase(photoUrl: string, width: number, areaH: number): Promise<Buffer | null> {
  try {
    const buf = await fetchImageBytes(photoUrl);
    if (!buf) return null;
    // "attention" keeps the jewellery in frame rather than centre-cropping it away.
    return await sharp(buf).resize({ width, height: areaH, fit: "cover", position: "attention" }).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * clients.logo_url is a bucket-relative path ("logos/1786….png"), not a URL.
 * Handing that straight to a fetch failed quietly, and every creative shipped
 * without the brand mark on it. Anything already carrying a scheme is left
 * exactly as it is.
 */
function resolveLogoUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/brand-assets/${path.replace(/^\/+/, "")}`;
}

/**
 * The client's logo, in a soft white chip at the top of the frame — the corner
 * for a sans layout, dead centre for a serif one, where the founder's own grid
 * puts its mark.
 *
 * A designer never ships a post without the mark on it; the pipeline was
 * skipping it entirely. The chip is there so the logo stays legible over a
 * dark photo just as reliably as a light one, and it is small on purpose —
 * this is a credit, not a second headline.
 */
async function logoLayer(logoUrl: string | null | undefined, width: number, height: number, centred = false): Promise<OverlayOptions[]> {
  const resolved = resolveLogoUrl(logoUrl);
  if (!resolved) return [];
  try {
    const buf = await fetchImageBytes(resolved);
    if (!buf) return [];
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

    const chipLeft = centred ? Math.round((width - (lw + pad * 2)) / 2) : margin;

    return [
      { input: chip, top: margin, left: chipLeft },
      { input: resized, top: margin + pad, left: chipLeft + pad },
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

/** What a running build writes to monthly_plans.build_progress as it works. */
export interface BuildProgress {
  startedAt: string;
  updatedAt: string;
  /** Frames this run set out to make, and how many it has got through. */
  totalFrames: number;
  doneFrames: number;
  /** Where it is right now, in the founder's words rather than the log's. */
  step: string;
  finished: boolean;
  note: string;
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
  logoUrl?: string | null,
  styleBlock = ""
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
    console.log(`      · fetching product photo: ${photoUrl.slice(0, 90)}`);
    const photo = await productBase(photoUrl, width, bandTop);
    console.log(`      · product photo ${photo ? "read" : "UNREADABLE"}.`);
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
    console.log(`      · generating background scene (this is the slow one)…`);
    const { buffer, error } = await generateBrandImage(buildScenePrompt(spec, styleBlock), shapeFor(spec));
    console.log(`      · background scene ${buffer ? "generated" : `FAILED: ${error}`}.`);
    if (buffer) {
      hasImagery = true;
      base = await sharp(buffer).resize({ width, height, fit: "cover" }).png().toBuffer();
    } else {
      // The old fallback composited the type over a flat colour and filed it
      // anyway — five plain-background "creatives" for one carousel, every one
      // failing QC and cluttering approvals. A scene post with no scene is a
      // failed frame: pay nothing further, store nothing, say why.
      throw new Error(`Image generation failed (${error}) — this frame wasn't saved. Click Build again to retry it.`);
    }
  }

  if (!base) base = await canvas(spec, width, height);

  const logo = await logoLayer(logoUrl, width, height, spec.typeStyle === "serif");

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
      purpose: "qc-critic (5b)",
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
  options: { items?: number[]; limit?: number; styleCategory?: string | null } = {}
): Promise<{ created: number; failed: number; notes: string[] }> {
  const admin = createServiceRoleClient();

  // The run's own account of where it has got to, written as it goes.
  //
  // A build answers once, four minutes later. Until now the only place its
  // truth existed was the server log — which says exactly where it is and is
  // never seen — so the founder watched a spinner and could not tell a working
  // batch from a hung one. Every write below sits beside the console.log it
  // mirrors, so the two cannot drift apart.
  //
  // Like logUsage, this must never take down the work it describes: a failed
  // write is swallowed and the build carries on.
  const progress: BuildProgress = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalFrames: 0,
    doneFrames: 0,
    step: "Starting…",
    finished: false,
    note: "",
  };
  const report = async (patch: Partial<BuildProgress>): Promise<void> => {
    Object.assign(progress, patch, { updatedAt: new Date().toISOString() });
    try {
      await admin.from("monthly_plans").update({ build_progress: progress }).eq("id", planId);
    } catch {
      // Never let bookkeeping take down the build being booked.
    }
  };

  // Check the destination before making anything. Rendering and generating cost
  // real money, and there is no point spending it on posts that have nowhere to
  // be saved.
  if (!(await isDriveConnected())) {
    await report({
      step: "Google Drive isn't connected",
      finished: true,
      note: "Nothing was built — reconnect Drive under Integrations and run this again.",
    });
    return {
      created: 0,
      failed: 0,
      notes: ["Google Drive isn't connected, so nothing was built. Reconnect it under Integrations and run this again — no images were generated, so this cost nothing."],
    };
  }

  // This whole path used to run silently, so a batch that stalled was
  // indistinguishable in the logs from one that was never started. Each step
  // announces itself with its elapsed time; the last line printed is the step
  // that hung.
  const t0 = Date.now();
  const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  console.log(`🎨 Studio: analysing plan ${planId}…`);
  // Written before the design pass, which is itself a slow model call on a
  // cache miss — that silence was the worst of the wait.
  await report({ step: "Designing the posts…" });

  // Design under the same style the page was showing, or the build quietly
  // makes something other than what was previewed.
  const plan = await analysePlan(planId, options.styleCategory || undefined);
  console.log(`🎨 Studio: plan analysed at ${since()} — ${plan.specs.length} post(s) designed.`);
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

  // The denominator is every frame this run set out to make. A product post
  // skipped for want of a photo still counts toward it — the skip note in the
  // result explains the shortfall, and a denominator that shifts under the bar
  // is exactly the dishonesty this is meant to end.
  const totalFrames = chosen.reduce((n, s) => n + s.frames, 0);
  let doneFrames = 0;
  await report({ totalFrames, step: `${chosen.length} post(s) to build · ${totalFrames} frame(s)` });

  // The batch has to finish answering before something upstream cuts the line.
  // The Surat run proved what happens otherwise: slow image generations pushed
  // the request past the six-minute mark, the connection died as a bare 502,
  // and the founder saw an error instead of the two posts that HAD been made.
  // So no new frame starts after this point in the clock — whatever is done
  // gets reported, whatever isn't gets named, and the next click continues.
  // The worst a frame can cost is two image tries (timeout + retry) plus
  // checking and filing. The cutoff for STARTING a frame moves down as the
  // configured image timeout moves up, so raising the provider's patience in
  // .env can never push the whole request past the point where the connection
  // dies — the ceiling stays fixed, only the split moves.
  const WORST_FRAME_MS = 2 * IMAGE_TIMEOUT_MS + 60_000;
  const BUDGET_MS = Math.min(240_000, 570_000 - WORST_FRAME_MS);
  const overBudget = () => Date.now() - t0 > BUDGET_MS;
  const unattempted: number[] = [];
  let paused = false;
  let postNo = 0;

  for (const spec of chosen) {
    // Position in this run, not the calendar row number: building posts 6 and 9
    // on their own should read "Post 1 of 2", not "Post 6 of 2".
    postNo++;
    const where = (frame: number) => `Post ${postNo} of ${chosen.length} · frame ${frame + 1} of ${spec.frames}`;
    if (paused) {
      unattempted.push(spec.item + 1);
      continue;
    }
    const photos = photoByItem[String(spec.item)] || [];
    if (spec.kind === "product" && photos.length === 0) {
      notes.push(`Post ${spec.item + 1} (“${spec.headline}”) skipped — it needs a product photo.`);
      // Its frames were counted in the total, so credit them here or a healthy
      // run finishes at 80% and the bar teaches the founder to distrust it.
      doneFrames += spec.frames;
      await report({ doneFrames });
      continue;
    }

    console.log(`🎨 Studio: post ${spec.item + 1} (${spec.kind}, ${spec.frames} frame(s)) starting at ${since()}.`);

    // The proven-look exemplars for this post, when a category was chosen.
    // Empty string when the library has nothing — old behaviour, unchanged.
    const styleBlock = options.styleCategory && spec.kind === "generated"
      ? await styleBlockFor(spec, options.styleCategory, plan.clientId)
      : "";

    for (let frame = 0; frame < spec.frames; frame++) {
      if (overBudget()) {
        paused = true;
        if (frame > 0) notes.push(`Post ${spec.item + 1}: paused after frame ${frame} of ${spec.frames} — the rest will be made on the next Build.`);
        else unattempted.push(spec.item + 1);
        break;
      }
      try {
        console.log(`   ↳ post ${spec.item + 1} frame ${frame + 1}/${spec.frames}: rendering… (${since()})`);
        await report({ step: `${where(frame)} · rendering` });
        const { buffer, note, content } = await renderFrame(spec, photos[frame] || photos[0] || null, frame, client?.logo_url, styleBlock);
        console.log(`   ↳ post ${spec.item + 1} frame ${frame + 1}: rendered, checking and filing… (${since()})`);
        await report({ step: `${where(frame)} · checking and filing` });

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
            await report({ step: "Stopped — Google Drive refused the upload", finished: true, note: "Every remaining post would have failed the same way." });
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
        console.log(`   ✅ post ${spec.item + 1} frame ${frame + 1} saved (${since()}).`);
        if (!verdict.ok) notes.push(`Post ${spec.item + 1} needs a look: ${verdict.issues.join("; ")}`);
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`   ❌ post ${spec.item + 1} frame ${frame + 1} failed after ${since()}: ${msg}`);
        notes.push(`Post ${spec.item + 1}: ${msg}`);
      } finally {
        // Done means attempted. A frame that failed is still a frame nobody is
        // waiting on any more, and counting only the successes would leave the
        // bar short of the end on a run that had finished.
        doneFrames++;
        await report({ doneFrames });
      }
    }
  }

  if (paused) {
    notes.push(
      `Paused after ${since()} so this run could report back safely${unattempted.length ? ` — post(s) ${unattempted.join(", ")} weren't attempted` : ""}. Click Build again to continue; posts already made are not remade.`
    );
  }

  console.log(`🎨 Studio: finished in ${since()} — ${created} created, ${failed} failed${paused ? ", paused early" : ""}.`);
  await report({
    step: `Finished — ${created} made${failed ? `, ${failed} failed` : ""}`,
    finished: true,
    note: paused ? "Paused — click Build again to continue." : "",
  });
  return { created, failed, notes };
}
