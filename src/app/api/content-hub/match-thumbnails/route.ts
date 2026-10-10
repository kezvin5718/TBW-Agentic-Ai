import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";
import { storeContentHubUpload, downloadDriveFileByUrl } from "@/lib/google-drive";
import sharp from "sharp";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Covers paired by sight.
 *
 * A video editor delivers nine reels and nine covers in one drop, and the
 * founder will not have anyone renaming files to make them line up — so the
 * pairing is done by looking. One vision call per video: a frame from the
 * middle of it beside every cover still on the table, numbered, and the
 * question "which of these is this creative's cover?". The model is allowed
 * to say "none", and anything it is not sure of is left for a person. A wrong
 * cover on a live reel is worse than no cover, so the bot never guesses.
 *
 * Four jobs share this route, because they are one feature:
 *   - multipart { pool: true }        → store the covers, hand back { url, name }
 *   - JSON { clientId, videoIds, images } → the matcher
 *   - JSON { assign: { videoId, image } } → a person's override, no AI
 *   - JSON { adopt: { clientId, images } } → the images no video claimed become posts
 */

interface PoolImage { url: string; name: string }
interface Pair { videoId: string; image: PoolImage | null; confidence: "high" | "low" | null; note?: string }

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_VIDEOS = 20;
const MAX_IMAGES = 20;
/** Videos are read a few at a time — each one is a download and an ffmpeg run. */
const CONCURRENCY = 3;

const isImageFile = (f: File) =>
  (f.type || "").startsWith("image") || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name || "");

/**
 * Only URLs our own storage handed out are fetched or written as covers. The
 * pool step returns them, but they come back through the browser, and this
 * route must not become a way to make the server fetch anything it is told.
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
  return { url, name: String(o.name || "cover").slice(0, 200) };
}

// --- Same fetch + frame + resize steps as the QC route ------------------------

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-160)}`))));
    p.on("error", reject);
  });
}

/**
 * One frame from the middle of the video. QC takes t=1s, which on a reel is
 * usually the logo sting — the middle is where the product and the offer text
 * sit, and those are what a cover repeats.
 */
async function extractVideoFrame(buf: Buffer): Promise<Buffer> {
  const base = join(tmpdir(), `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const inPath = `${base}.mp4`;
  const outPath = `${base}.jpg`;
  try {
    await writeFile(inPath, buf);
    let at = 1;
    try {
      const d = Number(String(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inPath])).trim());
      if (d > 0.5) at = d / 2;
    } catch { /* no duration — fall back to QC's 1s */ }
    await run("ffmpeg", ["-y", "-ss", at.toFixed(2), "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
    return await readFile(outPath);
  } finally {
    rm(inPath, { force: true }).catch(() => {});
    rm(outPath, { force: true }).catch(() => {});
  }
}

async function fetchMediaBuffer(url: string): Promise<Buffer> {
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
    const b = await downloadDriveFileByUrl(url);
    if (b) return b;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`could not fetch media (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

// --- The sheet the model looks at ---------------------------------------------
//
// completeVision sends exactly one image, so the frame and the candidates are
// laid out on one numbered sheet: the video frame on the left, the covers in a
// grid on the right. These are working copies only — the stored covers are
// never touched, and the one that wins is attached by its original URL.

const FRAME_W = 420;
const FRAME_H = 746;
const TILE_W = 280;
const TILE_H = 350;
const LABEL_H = 44;
const GAP = 16;
const BG = { r: 17, g: 17, b: 17, alpha: 1 };

const label = (text: string, w: number, fill: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_H}"><rect width="100%" height="100%" fill="${fill}"/><text x="12" y="31" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" fill="#000">${text}</text></svg>`
  );

const tile = (buf: Buffer, w: number, h: number) =>
  sharp(buf).rotate().resize({ width: w, height: h, fit: "contain", background: BG }).jpeg({ quality: 80 }).toBuffer();

async function buildSheet(frame: Buffer, candidates: Buffer[], cols: number): Promise<string> {
  const rows = Math.ceil(candidates.length / cols);
  const gridX = GAP + FRAME_W + GAP * 2;
  const width = gridX + cols * (TILE_W + GAP);
  const height = GAP + Math.max(LABEL_H + FRAME_H, rows * (LABEL_H + TILE_H + GAP));
  const layers: Array<{ input: Buffer; left: number; top: number }> = [
    { input: label("VIDEO FRAME", FRAME_W, "#FFD400"), left: GAP, top: GAP },
    { input: await tile(frame, FRAME_W, FRAME_H), left: GAP, top: GAP + LABEL_H },
  ];
  candidates.forEach((c, i) => {
    const left = gridX + (i % cols) * (TILE_W + GAP);
    const top = GAP + Math.floor(i / cols) * (LABEL_H + TILE_H + GAP);
    layers.push({ input: label(`#${i + 1}`, TILE_W, "#FFFFFF"), left, top });
    layers.push({ input: c, left, top: top + LABEL_H });
  });
  const sheet = await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${sheet.toString("base64")}`;
}

const MATCH_SYSTEM =
  "You match advertising videos to the cover images designed for them. You compare product, on-screen text and layout carefully, you never guess, and you reply with JSON only.";

const matchPrompt = (n: number, cols: number) => `The image is a sheet. On the LEFT, labelled "VIDEO FRAME", is a frame from the middle of one advertising video. On the RIGHT are ${n} candidate cover image${n > 1 ? "s" : ""}, labelled #1 to #${n}, laid out left-to-right then top-to-bottom in rows of ${cols}.

Which candidate is the cover of THIS EXACT creative — the same product piece, the same text and offer, the same layout and design? A cover is usually a designed still of the video, so it need not be the identical frame, but it must be the same creative. Several candidates are covers for sibling videos of the same brand and will look alike: tell them apart by the exact product, the words and numbers on them, and the composition. Same brand or same colours alone is NOT a match.

Return JSON exactly:
{ "answer": <the candidate number> | "none", "confidence": "high" | "low", "reason": "<one short line>" }

"high" only when you are certain this candidate and no other is the cover. If none fits, or two fit equally well, or the frame shows too little to tell, say so — answer "none" or give "low".`;

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

// --- Handler ------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden — designers/founders only" }, { status: 403 });
  }
  const admin = createServiceRoleClient();

  // ---- Pool: store the covers, record nothing --------------------------------
  // Covers in a mixed drop are not posts, so they never become hub rows. They
  // go to the same Drive folder a single upload's thumbnail goes to, and wait
  // there for a video to claim them.
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await request.formData();
    if (String(form.get("pool") || "") !== "true") {
      return NextResponse.json({ error: "Multipart is only accepted for the cover pool" }, { status: 400 });
    }
    const clientId = (form.get("clientId") as string | null) || null;
    const files = [...form.getAll("files[]"), ...form.getAll("file")].filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No images uploaded" }, { status: 400 });
    if (files.length > MAX_IMAGES) return NextResponse.json({ error: `Up to ${MAX_IMAGES} covers at a time` }, { status: 400 });
    const notImages = files.filter((f) => !isImageFile(f));
    if (notImages.length > 0) {
      return NextResponse.json({ error: `Only images can be covers — ${notImages.map((f) => f.name).join(", ")} is not one.` }, { status: 400 });
    }

    let clientName: string | undefined;
    if (clientId) {
      const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();
      clientName = client?.name || undefined;
    }
    const monthLabel = new Date().toISOString().slice(0, 7);

    const images: PoolImage[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const f of files) {
      // Byte-for-byte: the file goes up exactly as the designer exported it.
      const buf = Buffer.from(await f.arrayBuffer());
      const safe = (f.name || "thumb").replace(/[^a-zA-Z0-9._-]/g, "_");
      const url = await storeContentHubUpload(buf, `${Date.now()}-thumb-${safe}`, f.type || "image/jpeg", clientName, monthLabel);
      if (url) images.push({ url, name: f.name || safe });
      else failed.push({ name: f.name, error: "storage failed" });
    }
    if (images.length === 0) {
      return NextResponse.json({ error: "Upload failed — check Google Drive / storage connection.", failed }, { status: 500 });
    }
    return NextResponse.json({ success: true, images, failed });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // ---- Explicit: a person picks (or clears) one cover ------------------------
  if (body.assign && typeof body.assign === "object") {
    const a = body.assign as { videoId?: unknown; image?: unknown };
    const videoId = String(a.videoId || "");
    if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
    const image = a.image === null ? null : cleanImage(a.image);
    if (a.image !== null && !image) return NextResponse.json({ error: "That cover is not one of our stored files" }, { status: 400 });

    const { data: row } = await admin.from("creative_uploads").select("id, media_type").eq("id", videoId).single();
    if (!row) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    if (row.media_type !== "video") return NextResponse.json({ error: "Only a video takes a cover" }, { status: 400 });

    const { error } = await admin
      .from("creative_uploads")
      .update({ thumbnail_url: image?.url ?? null, thumbnail_name: image?.name ?? null })
      .eq("id", videoId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const pair: Pair = { videoId, image, confidence: null };
    return NextResponse.json({ success: true, pair });
  }

  // ---- Adopt: an image no video claimed is a post ------------------------------
  // One uploader takes any mix now, so a standalone graphic arrives in the same
  // drop as the reels and their covers. It is already stored — the pool put it
  // there — so it becomes a post by being recorded, not by going up again. The
  // row is the one the main upload writes for an image post, and QC takes it
  // from there like any other.
  if (body.adopt && typeof body.adopt === "object") {
    const a = body.adopt as { clientId?: unknown; images?: unknown; batchId?: unknown };
    const clientId = String(a.clientId || "");
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
    const raw = Array.isArray(a.images) ? a.images : [];
    if (raw.length === 0) return NextResponse.json({ error: "images required" }, { status: 400 });
    if (raw.length > MAX_IMAGES) return NextResponse.json({ error: `Up to ${MAX_IMAGES} images at a time` }, { status: 400 });

    // Same fence as the matcher: only files our own storage handed out. One
    // stranger in the list and nothing is recorded — this is not a way to put
    // an arbitrary URL into the hub.
    const images: Array<PoolImage & { size: number | null }> = [];
    for (const v of raw) {
      const img = cleanImage(v);
      if (!img) return NextResponse.json({ error: "One of those images is not one of our stored files" }, { status: 400 });
      if (images.some((x) => x.url === img.url)) continue;
      const size = Number((v as { size?: unknown }).size);
      images.push({ ...img, size: Number.isFinite(size) && size > 0 ? Math.round(size) : null });
    }

    const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Files chosen together share a batch, as on the main upload — the posts
    // went up in the same drop as the reels.
    const batchId = typeof a.batchId === "string" && /^[0-9a-f-]{36}$/i.test(a.batchId) ? a.batchId : null;

    // A second click must not make a second post, and a file that is a video's
    // cover is not also a post — one cover, one video.
    const urls = images.map((i) => i.url);
    const [{ data: asPosts }, { data: asCovers }] = await Promise.all([
      admin.from("creative_uploads").select("file_url").in("file_url", urls),
      admin.from("creative_uploads").select("thumbnail_url").in("thumbnail_url", urls),
    ]);
    const already = new Set((asPosts || []).map((r) => r.file_url as string));
    const covering = new Set((asCovers || []).map((r) => r.thumbnail_url as string));
    const skipped: Array<{ url: string; name: string; reason: string }> = [];
    const toAdopt = images.filter((img) => {
      if (already.has(img.url)) { skipped.push({ url: img.url, name: img.name, reason: "already a post" }); return false; }
      if (covering.has(img.url)) { skipped.push({ url: img.url, name: img.name, reason: "is a video's cover" }); return false; }
      return true;
    });
    if (toAdopt.length === 0) return NextResponse.json({ success: true, uploads: [], skipped });

    const { data: rows, error } = await admin
      .from("creative_uploads")
      .insert(
        toAdopt.map((img) => ({
          client_id: clientId,
          uploaded_by: user.id,
          file_url: img.url,
          file_name: img.name,
          file_size: img.size,
          media_type: "image",
          content_type: "post",
          caption: "",
          thumbnail_url: null,
          thumbnail_name: null,
          festival_id: null,
          batch_id: batchId,
          status: "uploaded",
          qc_status: "pending",
        }))
      )
      .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, uploads: rows || [], skipped });
  }

  // ---- Matcher ----------------------------------------------------------------
  const clientId = String(body.clientId || "");
  const videoIds = Array.isArray(body.videoIds) ? body.videoIds.map(String).filter(Boolean) : [];
  const reassign = body.reassign === true;
  const offered = (Array.isArray(body.images) ? body.images : []).map(cleanImage).filter((x): x is PoolImage => !!x);
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (videoIds.length === 0) return NextResponse.json({ error: "videoIds required" }, { status: 400 });
  if (videoIds.length > MAX_VIDEOS || offered.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Up to ${MAX_VIDEOS} videos and ${MAX_IMAGES} covers per match` }, { status: 400 });
  }

  const { data: rows, error: rowsErr } = await admin
    .from("creative_uploads")
    .select("id, client_id, media_type, file_url, thumbnail_url, thumbnail_name")
    .in("id", videoIds);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  const byId = new Map((rows || []).map((r) => [r.id as string, r]));

  // Settled before any looking: rows that are not this client's videos, and
  // videos that already carry a cover (unless the caller asked to redo them).
  const settled = new Map<string, Pair>();
  const toMatch: Array<{ id: string; file_url: string }> = [];
  const alreadyCovering = new Set<string>();
  for (const id of videoIds) {
    const r = byId.get(id);
    if (!r || r.client_id !== clientId) { settled.set(id, { videoId: id, image: null, confidence: null, note: "not found for this client" }); continue; }
    if (r.media_type !== "video") { settled.set(id, { videoId: id, image: null, confidence: null, note: "not a video" }); continue; }
    if (r.thumbnail_url && !reassign) {
      alreadyCovering.add(r.thumbnail_url as string);
      settled.set(id, {
        videoId: id,
        image: { url: r.thumbnail_url as string, name: (r.thumbnail_name as string | null) || "cover" },
        confidence: null,
        note: "already had a cover",
      });
      continue;
    }
    toMatch.push({ id, file_url: r.file_url as string });
  }

  // The candidates are the covers nobody holds yet. Each is read and shrunk
  // once for the sheet; one that will not decode (a HEIC sharp can't open)
  // simply sits out the looking and stays in the pool for a person to pick.
  const pool = offered.filter((img, i, all) => !alreadyCovering.has(img.url) && all.findIndex((x) => x.url === img.url) === i);
  const readable: Array<{ img: PoolImage; tile: Buffer }> = [];
  await mapLimit(pool, CONCURRENCY, async (img) => {
    try {
      readable.push({ img, tile: await tile(await fetchMediaBuffer(img.url), TILE_W, TILE_H) });
    } catch (err: unknown) {
      console.warn(`thumb-match: cover "${img.name}" unreadable — left for a person:`, err instanceof Error ? err.message : err);
    }
  });
  // Pool order, not finish order, so "#3" means the same cover on every sheet.
  readable.sort((a, b) => pool.indexOf(a.img) - pool.indexOf(b.img));
  const cols = readable.length <= 4 ? Math.max(1, readable.length) : readable.length <= 9 ? 3 : 4;

  type Claim = { videoId: string; idx: number | null; confidence: "high" | "low" | null; note: string };
  const claims: Claim[] = await mapLimit(toMatch, CONCURRENCY, async (v): Promise<Claim> => {
    if (readable.length === 0) return { videoId: v.id, idx: null, confidence: null, note: "no readable covers to compare" };
    try {
      const buf = await fetchMediaBuffer(v.file_url);
      if (buf.length > MAX_VIDEO_BYTES) throw new Error("video too large to read (>200MB)");
      const frame = await extractVideoFrame(buf);
      const raw = await completeVision({
        purpose: "thumb-match",
        model: MODEL_FAST,
        maxTokens: 200,
        system: MATCH_SYSTEM,
        prompt: matchPrompt(readable.length, cols),
        imageDataUrl: await buildSheet(frame, readable.map((r) => r.tile), cols),
      });
      const ans = safeJsonParse<{ answer?: unknown; confidence?: unknown; reason?: unknown }>(raw, {});
      const n = typeof ans.answer === "number" ? ans.answer : Number(String(ans.answer ?? "").replace(/^#/, ""));
      const conf = ans.confidence === "high" ? "high" : ans.confidence === "low" ? "low" : null;
      const idx = Number.isInteger(n) && n >= 1 && n <= readable.length ? n - 1 : null;
      return { videoId: v.id, idx, confidence: idx === null ? null : conf, note: String(ans.reason || "").slice(0, 200) };
    } catch (err: unknown) {
      return { videoId: v.id, idx: null, confidence: null, note: `could not read: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // Uniqueness. Only a high-confidence answer can claim a cover at all; a cover
  // claimed by exactly one video goes to it. Claimed by two, neither gets it —
  // there is no fair way to pick between two certain answers, and a coin toss
  // is how covers end up swapped on live reels.
  const claimants = new Map<number, string[]>();
  for (const c of claims) {
    if (c.idx === null || c.confidence !== "high") continue;
    claimants.set(c.idx, [...(claimants.get(c.idx) || []), c.videoId]);
  }
  const used = new Set<string>();
  for (const c of claims) {
    let image: PoolImage | null = null;
    let note = c.note;
    if (c.idx !== null && c.confidence === "high") {
      if ((claimants.get(c.idx) || []).length === 1) image = readable[c.idx].img;
      else note = "another video claimed the same cover — pick by hand";
    } else if (c.idx !== null) {
      note = `unsure (thought #${c.idx + 1}) — pick by hand`;
    }
    if (image) {
      const { error } = await admin
        .from("creative_uploads")
        .update({ thumbnail_url: image.url, thumbnail_name: image.name })
        .eq("id", c.videoId);
      if (error) { image = null; note = `could not save: ${error.message}`; }
      else used.add(image.url);
    }
    settled.set(c.videoId, { videoId: c.videoId, image, confidence: image ? "high" : c.confidence, note });
  }

  const pairs = videoIds.map((id) => settled.get(id)!);
  const leftoverImages = pool.filter((img) => !used.has(img.url));
  return NextResponse.json({ success: true, pairs, leftoverImages });
}
