import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Carousels, found and then made.
 *
 * A designer drops a month of feed work in one go, and some of it is carousels
 * — five slides that are one post. Those are found here, cheapest first: the
 * filenames, which the designer numbered, and only for what the filenames
 * cannot place, one look at all the leftovers on a single labelled sheet.
 * Nothing here decides for a person. A grouping the filenames prove is offered
 * pre-ticked; one the model only sees is offered for a yes; anything with a
 * hole or a clash in its numbering stays as separate posts with the problem
 * named. A slide is never invented and an order is never made up.
 *
 * Two jobs, because they are one feature:
 *   - JSON { clientId, images: [{url, name}] }  → the groups, for the panel
 *   - JSON { create: { clientId, groups } }    → one hub row per carousel + its slides
 *
 * The images are already stored — the uploader's pool step put them there —
 * so neither job moves, re-encodes or re-uploads a byte of them.
 */

interface PoolImage { url: string; name: string }
type Confidence = "high" | "medium" | "low" | null;
type Source = "filename" | "markers" | "sight" | null;
interface Slide { slide_number: number | null; filename: string; url: string }
interface Group {
  post_type: "carousel" | "single";
  confidence: Confidence;
  requires_review: boolean;
  /** Where the grouping came from — the panel says it in words. */
  source: Source;
  slides: Slide[];
  missing_slides: number[];
  duplicate_slides: number[];
  note?: string;
}

/** Instagram's own ceiling on a carousel, and the most one detect call takes. */
const MAX_SLIDES = 20;
const MAX_IMAGES = 30;
const MAX_GROUPS = 15;
/** What a carousel slide may be. A HEIC or a GIF can still be a post on its own. */
const SLIDE_EXT = /\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 4;

/**
 * Only URLs our own storage handed out are read or recorded — the same fence
 * as match-thumbnails. The pool returned them, but they come back through the
 * browser, and this route must not become a way to make the server fetch, or
 * the hub hold, anything it is told.
 */
function isOurStorageUrl(url: string): boolean {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return false;
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) return true;
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!sb && url.startsWith(sb);
}

function cleanImage(v: unknown): PoolImage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { url?: unknown; name?: unknown };
  const url = String(o.url || "");
  if (!isOurStorageUrl(url)) return null;
  return { url, name: String(o.name || "image").slice(0, 200) };
}

async function fetchMediaBuffer(url: string): Promise<Buffer> {
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
    const b = await downloadDriveFileByUrl(url);
    if (b) return b;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`could not fetch image (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Runs fn over items a few at a time, keeping results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// --- 1. Filenames ---------------------------------------------------------------
//
// A designer's numbering is the strongest evidence there is, so it is read
// first and it wins. The hard part is not finding numbers but refusing the
// ones that are not slide numbers: an offer ("25off", "25%"), a price
// ("rs499"), a size ("1080x1350"), a version ("v2"), a date or a time
// ("2026-10-19", "10.15.32"), a camera counter ("IMG_4521"). Only a standalone
// 1–2 digit number (or a zero-padded "003") between 0 and 20 is a candidate.

/** "photo (1).jpg", "post_2 copy.png" — a second download is the same file, not a new number. */
function stemOf(name: string): string {
  let s = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/\s*\(\d+\)\s*$/, "").replace(/[\s_-]*copy(?:[\s_-]*\d+)?\s*$/i, "");
    if (s === before) break;
  }
  return s.trim();
}

/** Spans that are dates or times — no number inside one is a slide number. */
function maskedSpans(stem: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const patterns = [
    /\d{4}[-_.]\d{1,2}[-_.]\d{1,2}/g, // 2026-10-19
    /\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}/g, // 19.10.26, 19-10-2026
    /\d{1,2}[.:]\d{2}(?:[.:]\d{2})?/g, // 10.15.32, 10:15
  ];
  for (const re of patterns) {
    for (const m of stem.matchAll(re)) spans.push([m.index!, m.index! + m[0].length]);
  }
  return spans;
}

interface NumToken { value: number; start: number; end: number }

function candidateNumbers(stem: string): NumToken[] {
  const masked = maskedSpans(stem);
  const out: NumToken[] = [];
  for (const m of stem.matchAll(/\d+/g)) {
    const digits = m[0];
    const start = m.index!;
    const end = start + digits.length;
    if (digits.length > 3 || (digits.length === 3 && !digits.startsWith("0"))) continue;
    const value = Number(digits);
    if (value > MAX_SLIDES) continue;
    if (masked.some(([a, b]) => start >= a && end <= b)) continue;
    const before = stem.slice(0, start);
    const after = stem.slice(end);
    // An offer, a price, a quantity, a size, an ordinal — part of the message.
    if (/^\s*%/.test(after)) continue;
    if (/^\s*(?:x|×)\s*\d/i.test(after) || /\d\s*(?:x|×)\s*$/i.test(before)) continue;
    if (/(?:^|[^a-z])(?:rs|inr|usd|aed)\.?[\s_-]*$/i.test(before) || /[₹$][\s_-]*$/.test(before)) continue;
    if (/^[\s_-]*(?:off|rs|\/-|k|inr|ml|gm?|kg|ltr|l|cm|mm|ft|yrs?|days?|hrs?|am|pm|st|nd|rd|th)(?![a-z])/i.test(after)) continue;
    // A version is a revision of one image, not its place in a set.
    if (/(?:^|[^a-z])v(?:er(?:sion)?)?[\s_-]*$/i.test(before)) continue;
    out.push({ value, start, end });
  }
  return out;
}

/** "slide 2 of 5" names the size of the set — the only way a filename can say a slide is missing at the end. */
function totalOf(stem: string): number | null {
  const m = stem.match(/(\d{1,2})[\s_-]*of[\s_-]*(\d{1,2})/i);
  if (!m) return null;
  const t = Number(m[2]);
  return t >= 1 && t <= MAX_SLIDES ? t : null;
}

/** Numbers and separators aside, the name — what two slides of one set share. */
const keyPart = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "_");

interface Named { img: PoolImage; idx: number; stem: string; nums: NumToken[]; total: number | null }

interface FilenameResult {
  groups: Group[];
  /** Input indices the filenames could not place — these go on the sheet. */
  unplaced: number[];
}

function groupByFilename(images: PoolImage[], eligible: number[]): FilenameResult {
  const named: Named[] = eligible.map((idx) => {
    const stem = stemOf(images[idx].name);
    return { img: images[idx], idx, stem, nums: candidateNumbers(stem), total: totalOf(stem) };
  });

  // Shape: the name with every candidate number taken out. Files of one shape
  // differ only in their numbers.
  const shapeOf = (n: Named) => {
    let s = "";
    let at = 0;
    for (const t of n.nums) { s += keyPart(n.stem.slice(at, t.start)) + "\u0000"; at = t.end; }
    return s + keyPart(n.stem.slice(at));
  };
  const shapes = new Map<string, Named[]>();
  for (const n of named) {
    if (n.nums.length === 0) continue;
    const k = shapeOf(n);
    shapes.set(k, [...(shapes.get(k) || []), n]);
  }

  const groups: Group[] = [];
  const placed = new Set<number>();
  for (const [shape, members] of shapes) {
    if (members.length < 2) continue;
    const positions = members[0].nums.length;
    // The slide number is the last number that changes from file to file:
    // "brand_post2_slide3" is post 2, slide 3. If nothing changes, every file
    // carries the same number — a clash, read at the last position.
    const varying = Array.from({ length: positions }, (_, p) => p)
      .filter((p) => new Set(members.map((m) => m.nums[p].value)).size > 1);
    const slidePos = varying.length ? varying[varying.length - 1] : positions - 1;
    // The other numbers are part of the name: post 1 and post 2 are two sets.
    const sets = new Map<string, Named[]>();
    for (const m of members) {
      const k = `${shape}|${m.nums.map((t, p) => (p === slidePos ? "#" : String(t.value))).join(",")}`;
      sets.set(k, [...(sets.get(k) || []), m]);
    }
    for (const set of sets.values()) {
      if (set.length < 2) continue; // one file of a "set" proves nothing — the sheet may still place it
      const values = set.map((m) => m.nums[slidePos].value);
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
      const duplicate_slides = [...counts].filter(([, c]) => c > 1).map(([v]) => v).sort((a, b) => a - b);
      const base = Math.min(...values) === 0 ? 0 : 1;
      const totals = new Set(set.map((m) => m.total));
      const declared = totals.size === 1 ? [...totals][0] : null;
      const top = Math.max(...values, declared ?? 0);
      const missing_slides: number[] = [];
      for (let v = base; v <= top; v++) if (!counts.has(v)) missing_slides.push(v);
      const ordered = [...set].sort((a, b) => a.nums[slidePos].value - b.nums[slidePos].value || a.idx - b.idx);
      for (const m of set) placed.add(m.idx);

      if (duplicate_slides.length || missing_slides.length || set.length > MAX_SLIDES) {
        // A hole or a clash: nothing is guessed. They stay separate posts, and
        // the panel names the problem so a person can group them by hand.
        groups.push({
          post_type: "single",
          confidence: "low",
          requires_review: true,
          source: "filename",
          slides: ordered.map((m) => ({ slide_number: m.nums[slidePos].value, filename: m.img.name, url: m.img.url })),
          missing_slides,
          duplicate_slides,
          note: [
            duplicate_slides.length ? `slide ${duplicate_slides.join(", ")} appears more than once` : "",
            missing_slides.length ? `slide ${missing_slides.join(", ")} ${missing_slides.length === 1 ? "is" : "are"} missing` : "",
          ].filter(Boolean).join("; "),
        });
        continue;
      }
      groups.push({
        post_type: "carousel",
        confidence: "high",
        requires_review: false,
        source: "filename",
        // Numbered by position: a set that starts at 0 still reads 1, 2, 3 here.
        slides: ordered.map((m, i) => ({ slide_number: i + 1, filename: m.img.name, url: m.img.url })),
        missing_slides: [],
        duplicate_slides: [],
      });
    }
  }
  return { groups, unplaced: eligible.filter((i) => !placed.has(i)) };
}

// --- 2. The sheet ----------------------------------------------------------------
//
// completeVision sends one image, so every image the filenames could not place
// is laid out on one numbered sheet — the thumb-matcher's pattern. Working
// copies only; the stored files are never touched, and every answer is mapped
// back to them by label.

const LABEL_H = 40;
const GAP = 14;
const BG = { r: 17, g: 17, b: 17, alpha: 1 };

const label = (text: string, w: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="10" y="29" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="24" font-weight="bold" fill="#000">${text}</text></svg>`
  );

const tile = (buf: Buffer, w: number, h: number) =>
  sharp(buf).rotate().resize({ width: w, height: h, fit: "contain", background: BG }).jpeg({ quality: 80 }).toBuffer();

async function buildSheet(tiles: Buffer[], cols: number, w: number, h: number): Promise<string> {
  const rows = Math.ceil(tiles.length / cols);
  const width = GAP + cols * (w + GAP);
  const height = GAP + rows * (LABEL_H + h + GAP);
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  tiles.forEach((t, i) => {
    const left = GAP + (i % cols) * (w + GAP);
    const top = GAP + Math.floor(i / cols) * (LABEL_H + h + GAP);
    layers.push({ input: label(`#${i + 1}`, w), left, top });
    layers.push({ input: t, left, top: top + LABEL_H });
  });
  const sheet = await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${sheet.toString("base64")}`;
}

const DETECT_SYSTEM =
  "You sort a brand's designed social-media images into Instagram carousels and standalone posts. You compare design systems carefully, you never guess, and you reply with JSON only.";

const detectPrompt = (n: number, cols: number) => `The image is a sheet of ${n} designed social-media images for one brand, labelled #1 to #${n}, laid out left-to-right then top-to-bottom in rows of ${cols}.

Some of them may be the slides of one carousel: the same design system (palette, typography, frame, logo placement) AND a layout that continues from one slide to the next — a story told across slides, a shape or background that runs over the edge into the next slide, a cover followed by detail slides. The rest are standalone posts. The same brand, logo or colours alone does NOT make a carousel — a brand's separate posts share those too.

Read any slide marker printed on an image: "1/5", "2 of 5", "02", a page counter or numbered dots, usually small, in a corner or at an edge. A price, a discount or offer ("25% OFF", "₹499", "Buy 1 Get 1"), a date, a phone number, a product code, a quantity, or any number that is part of the message is NOT a slide marker — give null for that image.

Return JSON exactly:
{ "groups": [ { "images": [<label numbers in slide order>], "markers": [<the marker read on each image, in the same order, e.g. "1/5", or null>], "confidence": "high" | "medium", "reason": "<one short line>" } ], "singles": [<label numbers of standalone images>] }

Every label appears exactly once, either in one group or in singles. "high" only when you are certain these images are one carousel and nothing else on the sheet belongs to it; otherwise "medium". If you are unsure whether an image belongs, put it in singles.`;

/** "1/5", "2 of 5", "03", "slide 4" — and nothing else. "25% OFF" fails here as well as in the prompt. */
function parseMarker(v: unknown): { n: number; total: number | null } | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= MAX_SLIDES ? { n: v, total: null } : null;
  if (typeof v !== "string") return null;
  const m = v.match(/^\s*(?:slide\s*)?0*(\d{1,2})\s*(?:(?:\/|of)\s*0*(\d{1,2}))?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const total = m[2] ? Number(m[2]) : null;
  if (n < 1 || n > MAX_SLIDES) return null;
  if (total !== null && (total < n || total > MAX_SLIDES)) return null;
  return { n, total };
}

interface SightResult { groups: Group[]; state: "used" | "skipped" | "down" }

async function groupBySight(images: PoolImage[], idxs: number[]): Promise<SightResult> {
  const single = (i: number, note?: string): Group => ({
    post_type: "single", confidence: null, requires_review: false, source: null,
    slides: [{ slide_number: null, filename: images[i].name, url: images[i].url }],
    missing_slides: [], duplicate_slides: [], ...(note ? { note } : {}),
  });
  if (idxs.length < 2) return { groups: idxs.map((i) => single(i)), state: "skipped" };

  // An image that will not decode simply sits the looking out, as a post.
  const read = await mapLimit(idxs, CONCURRENCY, async (i) => {
    try { return { i, buf: await fetchMediaBuffer(images[i].url) }; }
    catch { return { i, buf: null as Buffer | null }; }
  });
  const small = idxs.length <= 12;
  const w = small ? 240 : 180;
  const h = small ? 300 : 225;
  const onSheet: Array<{ i: number; tile: Buffer }> = [];
  const unreadable: number[] = [];
  for (const r of read) {
    if (!r.buf) { unreadable.push(r.i); continue; }
    try { onSheet.push({ i: r.i, tile: await tile(r.buf, w, h) }); }
    catch { unreadable.push(r.i); }
  }
  const out: Group[] = unreadable.map((i) => single(i, "could not be read to compare"));
  if (onSheet.length < 2) return { groups: [...out, ...onSheet.map((s) => single(s.i))], state: "skipped" };

  const n = onSheet.length;
  const cols = n <= 4 ? n : n <= 9 ? 3 : n <= 16 ? 4 : 5;
  type Answer = { groups?: unknown; singles?: unknown };
  let ans: Answer;
  try {
    const raw = await completeVision({
      purpose: "carousel-detect",
      model: MODEL_FAST,
      maxTokens: 900,
      system: DETECT_SYSTEM,
      prompt: detectPrompt(n, cols),
      imageDataUrl: await buildSheet(onSheet.map((s) => s.tile), cols, w, h),
    });
    ans = safeJsonParse<Answer>(raw, {});
  } catch (err: unknown) {
    console.warn("carousel-detect: vision unavailable —", err instanceof Error ? err.message : err);
    ans = {};
  }
  // No usable answer (the model down, mock mode, or prose): every one of them
  // is a post, and the panel still lets a person group them by hand.
  if (!Array.isArray(ans.groups)) return { groups: [...out, ...onSheet.map((s) => single(s.i))], state: "down" };

  const labelOf = (v: unknown): number | null => {
    const k = typeof v === "number" ? v : Number(String(v ?? "").replace(/^#/, ""));
    return Number.isInteger(k) && k >= 1 && k <= n ? k - 1 : null;
  };
  type Raw = { members: Array<{ s: number; marker: unknown }>; high: boolean };
  const raws: Raw[] = [];
  for (const g of ans.groups as unknown[]) {
    if (!g || typeof g !== "object") continue;
    const o = g as { images?: unknown; markers?: unknown; confidence?: unknown };
    const imgs = Array.isArray(o.images) ? o.images : [];
    const markers = Array.isArray(o.markers) && o.markers.length === imgs.length ? o.markers : null;
    const seen = new Set<number>();
    const members: Raw["members"] = [];
    imgs.forEach((v, k) => {
      const s = labelOf(v);
      if (s === null || seen.has(s)) return;
      seen.add(s);
      members.push({ s, marker: markers ? markers[k] : null });
    });
    raws.push({ members, high: o.confidence === "high" });
  }
  // An image two groups both claim belongs to neither — there is no fair way
  // to pick, and a slide in the wrong carousel is worse than a separate post.
  const claims = new Map<number, number>();
  for (const r of raws) for (const m of r.members) claims.set(m.s, (claims.get(m.s) || 0) + 1);
  const grouped = new Set<number>();
  for (const r of raws) {
    const members = r.members.filter((m) => claims.get(m.s) === 1);
    if (members.length < 2 || members.length > MAX_SLIDES) continue;
    members.forEach((m) => grouped.add(m.s));
    const asSlide = (s: number, slide_number: number | null): Slide => {
      const img = images[onSheet[s].i];
      return { slide_number, filename: img.name, url: img.url };
    };

    // Markers order a carousel only when the model was sure AND every slide
    // carries a clean one. A medium read is never used to order anything.
    const parsed = members.map((m) => parseMarker(m.marker));
    if (r.high && parsed.every((p) => p)) {
      const nums = parsed.map((p) => p!.n);
      const counts = new Map<number, number>();
      for (const v of nums) counts.set(v, (counts.get(v) || 0) + 1);
      const duplicate_slides = [...counts].filter(([, c]) => c > 1).map(([v]) => v).sort((a, b) => a - b);
      const totals = new Set(parsed.map((p) => p!.total).filter((t): t is number => t !== null));
      const declared = totals.size === 1 ? [...totals][0] : 0;
      const top = Math.max(...nums, declared);
      const missing_slides: number[] = [];
      for (let v = 1; v <= top; v++) if (!counts.has(v)) missing_slides.push(v);
      const ordered = members.map((m, k) => ({ s: m.s, n: nums[k] })).sort((a, b) => a.n - b.n || a.s - b.s);
      if (duplicate_slides.length || missing_slides.length || totals.size > 1) {
        out.push({
          post_type: "single", confidence: "low", requires_review: true, source: "markers",
          slides: ordered.map((o) => asSlide(o.s, o.n)),
          missing_slides, duplicate_slides,
          note: [
            duplicate_slides.length ? `the marker for slide ${duplicate_slides.join(", ")} appears more than once` : "",
            missing_slides.length ? `the marker for slide ${missing_slides.join(", ")} is missing` : "",
            totals.size > 1 ? "the markers disagree on how many slides there are" : "",
          ].filter(Boolean).join("; "),
        });
        continue;
      }
      out.push({
        post_type: "carousel", confidence: "high", requires_review: false, source: "markers",
        slides: ordered.map((o, k) => asSlide(o.s, k + 1)),
        missing_slides: [], duplicate_slides: [],
      });
      continue;
    }

    // Grouped by sight with no numbering to trust: a suggestion, never a
    // pre-approved grouping, whatever confidence the model claimed. A sure
    // model's order is offered; an unsure model's order is not even that —
    // upload order stands until a person arranges it.
    const order = r.high ? members.map((m) => m.s) : members.map((m) => m.s).sort((a, b) => onSheet[a].i - onSheet[b].i);
    out.push({
      post_type: "carousel", confidence: "medium", requires_review: true, source: "sight",
      slides: order.map((s, k) => asSlide(s, k + 1)),
      missing_slides: [], duplicate_slides: [],
      note: r.high ? "no slide numbers — the order is a suggestion" : "order is upload order — check it",
    });
  }
  for (let s = 0; s < n; s++) if (!grouped.has(s)) out.push(single(onSheet[s].i));
  return { groups: out, state: "used" };
}

// --- Handler ------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden — designers/founders only" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // ---- Create: one hub row per carousel, then its slides in order -------------
  if (body.create && typeof body.create === "object") {
    const c = body.create as { clientId?: unknown; groups?: unknown };
    const clientId = String(c.clientId || "");
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
    const rawGroups = Array.isArray(c.groups) ? c.groups : [];
    if (rawGroups.length === 0) return NextResponse.json({ error: "groups required" }, { status: 400 });
    if (rawGroups.length > MAX_GROUPS) return NextResponse.json({ error: `Up to ${MAX_GROUPS} carousels at a time` }, { status: 400 });

    // The whole request is checked before anything is written. One stranger
    // URL, one HEIC slide, one image in two carousels — and nothing is made.
    const groups: Array<{ slides: PoolImage[]; cover: number }> = [];
    const everyUrl = new Set<string>();
    for (const g of rawGroups) {
      const o = (g && typeof g === "object" ? g : {}) as { slides?: unknown; coverIndex?: unknown };
      const raw = Array.isArray(o.slides) ? o.slides : [];
      if (raw.length < 2) return NextResponse.json({ error: "A carousel needs at least 2 slides" }, { status: 400 });
      if (raw.length > MAX_SLIDES) return NextResponse.json({ error: `A carousel takes at most ${MAX_SLIDES} slides` }, { status: 400 });
      const slides: PoolImage[] = [];
      for (const v of raw) {
        const img = cleanImage(v);
        if (!img) return NextResponse.json({ error: "One of those slides is not one of our stored files" }, { status: 400 });
        if (!SLIDE_EXT.test(img.name)) {
          return NextResponse.json({ error: `"${img.name}" can't be a carousel slide — only JPG, PNG or WEBP can.` }, { status: 400 });
        }
        if (everyUrl.has(img.url)) return NextResponse.json({ error: `"${img.name}" is in two carousels — it can only be in one.` }, { status: 400 });
        everyUrl.add(img.url);
        slides.push(img);
      }
      const ci = Number(o.coverIndex);
      groups.push({ slides, cover: Number.isInteger(ci) && ci >= 0 && ci < slides.length ? ci : 0 });
    }

    if (everyUrl.size > MAX_IMAGES) return NextResponse.json({ error: `Up to ${MAX_IMAGES} slides in one save` }, { status: 400 });
    const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // A second click must not make a second carousel, and an image already in
    // the hub — as a post, a reel's cover or another carousel's slide — is not
    // quietly recorded twice.
    const urls = [...everyUrl];
    const [{ data: asPosts }, { data: asCovers }, { data: asSlides }] = await Promise.all([
      admin.from("creative_uploads").select("file_url").in("file_url", urls),
      admin.from("creative_uploads").select("thumbnail_url").in("thumbnail_url", urls),
      admin.from("carousel_slides").select("file_url").in("file_url", urls),
    ]);
    const taken = new Set<string>([
      ...(asPosts || []).map((r) => r.file_url as string),
      ...(asCovers || []).map((r) => r.thumbnail_url as string),
      ...(asSlides || []).map((r) => r.file_url as string),
    ]);

    const created: Record<string, unknown>[] = [];
    const failed: Array<{ index: number; error: string }> = [];
    const skipped: Array<{ index: number; reason: string }> = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const clash = g.slides.find((s) => taken.has(s.url));
      if (clash) { skipped.push({ index: gi, reason: `"${clash.name}" is already in the hub` }); continue; }
      const cover = g.slides[g.cover];
      const { data: row, error } = await admin
        .from("creative_uploads")
        .insert({
          client_id: clientId,
          uploaded_by: user.id,
          file_url: cover.url,
          file_name: `${g.slides.length} slides — ${g.slides[0].name}`.slice(0, 240),
          file_size: null,
          media_type: "image",
          content_type: "carousel",
          caption: "",
          thumbnail_url: null,
          thumbnail_name: null,
          festival_id: null,
          batch_id: null,
          status: "uploaded",
          qc_status: "pending",
        })
        .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)")
        .single();
      if (error || !row) { failed.push({ index: gi, error: error?.message || "could not record the carousel" }); continue; }
      const { data: slideRows, error: slideErr } = await admin
        .from("carousel_slides")
        .insert(g.slides.map((s, k) => ({ upload_id: row.id, slide_no: k + 1, file_url: s.url, file_name: s.name })))
        .select("slide_no, file_url, file_name");
      if (slideErr) {
        // A carousel without its slides is a lie on the hub: the row goes too.
        await admin.from("creative_uploads").delete().eq("id", row.id);
        failed.push({ index: gi, error: `slides could not be saved (${slideErr.message}) — nothing kept` });
        continue;
      }
      g.slides.forEach((s) => taken.add(s.url));
      created.push({ ...row, slides: (slideRows || []).sort((a, b) => (a.slide_no as number) - (b.slide_no as number)) });
    }
    return NextResponse.json({ success: failed.length === 0, uploads: created, failed, skipped });
  }

  // ---- Detect --------------------------------------------------------------------
  const clientId = String(body.clientId || "");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const raw = Array.isArray(body.images) ? body.images : [];
  if (raw.length === 0) return NextResponse.json({ error: "images required" }, { status: 400 });
  if (raw.length > MAX_IMAGES) return NextResponse.json({ error: `Up to ${MAX_IMAGES} images at a time` }, { status: 400 });
  const images: PoolImage[] = [];
  for (const v of raw) {
    const img = cleanImage(v);
    if (!img) return NextResponse.json({ error: "One of those images is not one of our stored files" }, { status: 400 });
    if (!images.some((x) => x.url === img.url)) images.push(img);
  }
  const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // A HEIC or a GIF cannot be a slide; it is a post on its own, said so.
  const all = images.map((_, i) => i);
  const eligible = all.filter((i) => SLIDE_EXT.test(images[i].name));
  const notSlides: Group[] = all.filter((i) => !eligible.includes(i)).map((i) => ({
    post_type: "single", confidence: null, requires_review: false, source: null,
    slides: [{ slide_number: null, filename: images[i].name, url: images[i].url }],
    missing_slides: [], duplicate_slides: [],
    note: "only JPG, PNG or WEBP can be a carousel slide",
  }));

  const byName = groupByFilename(images, eligible);
  const bySight = await groupBySight(images, byName.unplaced);

  // Carousels first, then the sets kept apart with their problem, then posts —
  // each in the order its first image arrived.
  const firstIdx = (g: Group) => Math.min(...g.slides.map((s) => images.findIndex((x) => x.url === s.url)));
  const rank = (g: Group) => (g.post_type === "carousel" ? 0 : g.slides.length > 1 ? 1 : 2);
  const groups = [...byName.groups, ...bySight.groups, ...notSlides]
    .sort((a, b) => rank(a) - rank(b) || firstIdx(a) - firstIdx(b));
  return NextResponse.json({ success: true, groups, vision: bySight.state });
}
