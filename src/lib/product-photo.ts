import sharp from "sharp";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";

/**
 * Reduces a supplied image to just the jewellery.
 *
 * Designers hand over finished posts — gold border, logo, "ESTD 1945", a
 * tagline — because that is what they produce all day. Fed into the post
 * builder those get cropped through the middle and a second headline laid on
 * top, which is exactly what QC kept reporting.
 *
 * So the branding is removed before anything else happens. Two passes: trim
 * the uniform surround, then crop to where a vision model says the product
 * actually sits.
 *
 * The deliberate limit: this only *crops*. Text sitting on a plain background
 * disappears with the crop; text printed across the jewellery itself cannot be
 * removed without inventing pixels on a real product, and inventing product
 * detail is the one thing this pipeline will not do. Those photos are reported
 * back rather than silently mangled.
 */

export interface CleanedPhoto {
  buffer: Buffer;
  changed: boolean;
  note: string;
  /** Branding was detected across the product, so cropping cannot remove it. */
  needsHuman: boolean;
}

interface Box {
  /** All as 0-100 percentages of the image. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  branding_on_product: boolean;
  what: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export async function cleanProductPhoto(input: Buffer): Promise<CleanedPhoto> {
  const notes: string[] = [];

  // 1. Trim a uniform surround. Catches the plain border and any flat margin
  //    without touching anything that carries detail.
  let working = input;
  try {
    const trimmed = await sharp(input).trim({ threshold: 12 }).toBuffer();
    const before = await sharp(input).metadata();
    const after = await sharp(trimmed).metadata();
    if (after.width && before.width && after.width < before.width * 0.995) {
      working = trimmed;
      notes.push("trimmed the plain border");
    }
  } catch {
    /* trim is a bonus; carry on with the original */
  }

  // 2. Ask where the jewellery actually is.
  let box: Box | null = null;
  try {
    const small = await sharp(working).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const raw = await completeVision({
      purpose: "photo-cleaning",
      system: "You locate products in advertising images and answer only in JSON.",
      prompt: `This image may be a finished social media post rather than a plain product photograph. It can contain a decorative border, a brand logo, a shop name, a tagline or other text.

Give the bounding box of the JEWELLERY ONLY — the necklace, earrings, bangles or set. Exclude every logo, brand name, tagline, border and any other text.

Coordinates are percentages of the image, 0 to 100, where left/top are the top-left corner.

Also say whether any logo or text is printed ON TOP OF the jewellery itself, as opposed to sitting on the background around it.

Return JSON only:
{ "left": 0, "top": 0, "right": 100, "bottom": 100, "branding_on_product": false, "what": "short description of the jewellery" }`,
      imageDataUrl: `data:image/jpeg;base64,${small.toString("base64")}`,
    });
    let clean = raw.trim();
    if (clean.startsWith("```")) clean = clean.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
    box = safeJsonParse<Box>(clean, null as unknown as Box);
  } catch {
    /* no vision, no crop — the trim above still helps */
  }

  if (!box || ![box.left, box.top, box.right, box.bottom].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return {
      buffer: working,
      changed: working !== input,
      note: notes.join("; ") || "left as supplied",
      needsHuman: false,
    };
  }

  const meta = await sharp(working).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) {
    return { buffer: working, changed: working !== input, note: notes.join("; "), needsHuman: false };
  }

  // A little air around the piece so it does not sit tight against the edge.
  const pad = 2;
  const l = clamp(box.left - pad, 0, 100);
  const t = clamp(box.top - pad, 0, 100);
  const r = clamp(box.right + pad, 0, 100);
  const b = clamp(box.bottom + pad, 0, 100);

  const left = Math.round((l / 100) * W);
  const top = Math.round((t / 100) * H);
  const width = Math.max(1, Math.round(((r - l) / 100) * W));
  const height = Math.max(1, Math.round(((b - t) / 100) * H));

  // If the box is nearly the whole frame there was nothing to remove, and a
  // suspiciously tiny box means the model lost the product — don't act on either.
  const area = (width * height) / (W * H);
  if (area > 0.94) {
    return {
      buffer: working,
      changed: working !== input,
      note: [...notes, "no separate branding found to crop away"].join("; "),
      needsHuman: !!box.branding_on_product,
    };
  }
  if (area < 0.12) {
    return {
      buffer: working,
      changed: working !== input,
      note: [...notes, "product area looked too small to trust — left as supplied"].join("; "),
      needsHuman: !!box.branding_on_product,
    };
  }

  try {
    const cropped = await sharp(working).extract({ left, top, width, height }).png().toBuffer();
    notes.push(`cropped to the ${box.what || "product"}, removing the surrounding branding`);
    return {
      buffer: cropped,
      changed: true,
      note: notes.join("; "),
      needsHuman: !!box.branding_on_product,
    };
  } catch {
    return { buffer: working, changed: working !== input, note: notes.join("; "), needsHuman: !!box.branding_on_product };
  }
}
