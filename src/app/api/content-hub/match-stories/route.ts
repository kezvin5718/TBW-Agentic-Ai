import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import { isOurStorageUrl } from "@/lib/video-thumbnail";
import sharp from "sharp";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Stories paired with their posts by sight.
 *
 * Founder (27 Oct): designers make every creative twice — the feed post or reel,
 * and a 9:16 Story of the same thing. Nobody renames files to line them up, so
 * the pairing is done the way the cover matcher does it: one vision call per
 * post, the post beside every Story still waiting, numbered, and the question
 * "which of these is the Story version of THIS creative?". The model may say
 * "none", and anything it is not sure of is left for a person. A wrong Story
 * going out beside a post is worse than no Story, so the bot never guesses.
 *
 * The link lives on the POST row (linked_story_id), so deleting the post frees
 * its Story, and deleting the Story clears the post's link (FK set null). One
 * Story belongs to at most one post — a unique index says so, and this route
 * treats a clash with it as a clean refusal, never a crash.
 *
 * Three jobs share this route, because they are one feature:
 *   - JSON { clientId, postIds?, storyIds? } → the matcher, either direction
 *   - JSON { link: { postId, storyId } }     → a person's link, no AI
 *   - JSON { unlink: { postId } }            → a person's unlink, no AI
 */

interface Pair { postId: string; storyId: string | null; confidence: "high" | "low" | null; note?: string }

/** A post, reel or carousel can carry a Story. A Story cannot carry another. */
const POST_KINDS = ["post", "reel", "carousel"];
const MAX_POSTS = 20;
const MAX_STORIES = 20;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Posts are read a few at a time — a reel without a thumbnail is a download and an ffmpeg run. */
const CONCURRENCY = 3;
/** Postgres' unique_violation — the one-Story-one-post index said no. */
const UNIQUE_VIOLATION = "23505";

// --- Same fetch + frame steps as the cover matcher -------------------------------

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

/** One frame from the middle of the video — where the product and the offer sit. */
async function extractVideoFrame(buf: Buffer): Promise<Buffer> {
  const base = join(tmpdir(), `story-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const inPath = `${base}.mp4`;
  const outPath = `${base}.jpg`;
  try {
    await writeFile(inPath, buf);
    let at = 1;
    try {
      const d = Number(String(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inPath])).trim());
      if (d > 0.5) at = d / 2;
    } catch { /* no duration — 1s it is */ }
    await run("ffmpeg", ["-y", "-ss", at.toFixed(2), "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
    return await readFile(outPath);
  } finally {
    rm(inPath, { force: true }).catch(() => {});
    rm(outPath, { force: true }).catch(() => {});
  }
}

// Only URLs our own storage handed out are ever fetched (isOurStorageUrl, the
// same fence the cover matcher and the thumbnail engine use). These come off
// our own rows, not the browser, but the fence costs nothing and keeps this
// route from ever being a way to make the server fetch an arbitrary address.
async function fetchMediaBuffer(url: string): Promise<Buffer> {
  if (!isOurStorageUrl(url)) throw new Error("not one of our stored files");
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
    const b = await downloadDriveFileByUrl(url);
    if (b) return b;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`could not fetch media (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

interface MediaRow { media_type: string | null; file_url: string | null; thumbnail_url: string | null }

/**
 * The picture that stands for a row: an image is itself (a carousel's file_url
 * is its cover), a video is its thumbnail — designer, matched or automatic —
 * and, while it has none yet, a frame from its middle.
 */
async function pictureOf(r: MediaRow): Promise<Buffer> {
  if (r.media_type === "video") {
    if (r.thumbnail_url) return fetchMediaBuffer(r.thumbnail_url);
    const buf = await fetchMediaBuffer(String(r.file_url || ""));
    if (buf.length > MAX_VIDEO_BYTES) throw new Error("video too large to read (>200MB)");
    return extractVideoFrame(buf);
  }
  return fetchMediaBuffer(String(r.file_url || ""));
}

// --- The sheet the model looks at -------------------------------------------------
//
// completeVision sends exactly one image, so the post and the candidate Stories
// are laid out on one numbered sheet: the post on the left, the Stories in a
// grid of tall tiles on the right. Working copies only — no stored file is
// touched, and the winner is linked by its row id.

const FRAME_W = 480;
const FRAME_H = 600;
const TILE_W = 200;
const TILE_H = 356;
const LABEL_H = 44;
const GAP = 16;
const BG = { r: 17, g: 17, b: 17, alpha: 1 };

const label = (text: string, w: number, fill: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_H}"><rect width="100%" height="100%" fill="${fill}"/><text x="12" y="31" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" fill="#000">${text}</text></svg>`
  );

const tile = (buf: Buffer, w: number, h: number) =>
  sharp(buf).rotate().resize({ width: w, height: h, fit: "contain", background: BG }).jpeg({ quality: 80 }).toBuffer();

async function buildSheet(post: Buffer, candidates: Buffer[], cols: number): Promise<string> {
  const rows = Math.ceil(candidates.length / cols);
  const gridX = GAP + FRAME_W + GAP * 2;
  const width = gridX + cols * (TILE_W + GAP);
  const height = GAP + Math.max(LABEL_H + FRAME_H, rows * (LABEL_H + TILE_H + GAP));
  const layers: Array<{ input: Buffer; left: number; top: number }> = [
    { input: label("THIS CREATIVE", FRAME_W, "#FFD400"), left: GAP, top: GAP },
    { input: await tile(post, FRAME_W, FRAME_H), left: GAP, top: GAP + LABEL_H },
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
  "You match advertising feed posts to the 9:16 Story versions designed for them. You compare product, on-screen text, prices and design carefully, you never guess, and you reply with JSON only.";

const matchPrompt = (n: number, cols: number) => `The image is a sheet. On the LEFT, labelled "THIS CREATIVE", is one advertising feed post (or the cover of one reel). On the RIGHT are ${n} candidate Story image${n > 1 ? "s" : ""} (tall, 9:16), labelled #1 to #${n}, laid out left-to-right then top-to-bottom in rows of ${cols}.

Which of these Stories is the 9:16 version of THIS creative — the same product, the same offer/price text, the same headline, the same design? A Story version is re-laid-out for a taller frame, so elements may be moved, cropped, enlarged or spaced differently; that is fine. But it must be the same creative. Several candidates may be Stories for sibling creatives of the same brand and will look alike: tell them apart by the exact product, the words and numbers on them. Same brand, same colours or same logo alone is NOT a match.

Return JSON exactly:
{ "answer": <the candidate number> | "none", "confidence": "high" | "low", "reason": "<one short line>" }

"high" only when you are certain this candidate and no other is the Story version. If none fits, or two fit equally well, or the post shows too little to tell, say so — answer "none" or give "low".`;

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

const ROW_COLUMNS = "id, client_id, content_type, media_type, file_url, file_name, thumbnail_url, status, festival_id, linked_story_id, story_link_source, created_at";
type Row = {
  id: string; client_id: string | null; content_type: string; media_type: string | null;
  file_url: string | null; file_name: string | null; thumbnail_url: string | null;
  status: string; festival_id: string | null; linked_story_id: string | null;
  story_link_source: string | null; created_at: string;
};

// --- Handler ------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden — designers/founders only" }, { status: 403 });
  }
  const admin = createServiceRoleClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // ---- Explicit: a person links one Story to one post ---------------------------
  // A person's link is final: it replaces whatever the post had (that is what
  // "Change" means), it is marked manual, and the matcher never touches it
  // again. The Story must be this client's, waiting, and free — the unique
  // index has the last word on "free", and its refusal is said in words.
  if (body.link && typeof body.link === "object") {
    const l = body.link as { postId?: unknown; storyId?: unknown };
    const postId = String(l.postId || "");
    const storyId = String(l.storyId || "");
    if (!postId || !storyId) return NextResponse.json({ error: "postId and storyId required" }, { status: 400 });

    const { data: rows } = await admin.from("creative_uploads").select(ROW_COLUMNS).in("id", [postId, storyId]);
    const post = (rows || []).find((r) => r.id === postId) as Row | undefined;
    const story = (rows || []).find((r) => r.id === storyId) as Row | undefined;
    if (!post || !story) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    if (!POST_KINDS.includes(post.content_type)) return NextResponse.json({ error: "Only a post, reel or carousel can carry a Story" }, { status: 400 });
    if (story.content_type !== "story") return NextResponse.json({ error: "That upload is not a Story" }, { status: 400 });
    if (story.festival_id) return NextResponse.json({ error: "A festival Story schedules itself — it cannot travel with a post" }, { status: 400 });
    if (!post.client_id || post.client_id !== story.client_id) return NextResponse.json({ error: "The Story belongs to a different client" }, { status: 400 });
    if (post.status === "scheduled") return NextResponse.json({ error: "That post is already scheduled — its Story can no longer travel with it" }, { status: 400 });
    if (story.status === "scheduled") return NextResponse.json({ error: "That Story is already scheduled on its own" }, { status: 400 });

    const { error } = await admin
      .from("creative_uploads")
      .update({ linked_story_id: storyId, story_link_source: "manual" })
      .eq("id", postId);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const { data: holder } = await admin.from("creative_uploads").select("file_name").eq("linked_story_id", storyId).neq("id", postId).maybeSingle();
        return NextResponse.json(
          { error: `That Story is already linked to ${holder?.file_name ? `"${holder.file_name}"` : "another post"} — unlink it there first.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const pair: Pair = { postId, storyId, confidence: null, note: "linked by hand" };
    return NextResponse.json({ success: true, pair });
  }

  // ---- Explicit: a person unlinks a post's Story -----------------------------------
  // The Story itself is untouched — it goes back to waiting, and shows up on
  // its own in Automation again.
  if (body.unlink && typeof body.unlink === "object") {
    const postId = String((body.unlink as { postId?: unknown }).postId || "");
    if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });
    const { data: row } = await admin.from("creative_uploads").select("id, content_type").eq("id", postId).maybeSingle();
    if (!row) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    const { error } = await admin
      .from("creative_uploads")
      .update({ linked_story_id: null, story_link_source: null })
      .eq("id", postId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const pair: Pair = { postId, storyId: null, confidence: null, note: "unlinked" };
    return NextResponse.json({ success: true, pair });
  }

  // ---- Matcher ------------------------------------------------------------------
  const clientId = String(body.clientId || "");
  const askedPosts = Array.isArray(body.postIds) ? [...new Set(body.postIds.map(String).filter(Boolean))] : [];
  const askedStories = Array.isArray(body.storyIds) ? [...new Set(body.storyIds.map(String).filter(Boolean))] : [];
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (askedPosts.length === 0 && askedStories.length === 0) {
    return NextResponse.json({ error: "postIds or storyIds required" }, { status: 400 });
  }
  if (askedPosts.length > MAX_POSTS || askedStories.length > MAX_STORIES) {
    return NextResponse.json({ error: `Up to ${MAX_POSTS} posts and ${MAX_STORIES} stories per match` }, { status: 400 });
  }

  // Every Story some post already holds — a held Story is never a candidate.
  const { data: holders, error: holdErr } = await admin
    .from("creative_uploads")
    .select("linked_story_id")
    .eq("client_id", clientId)
    .not("linked_story_id", "is", null);
  if (holdErr) return NextResponse.json({ error: holdErr.message }, { status: 500 });
  const held = new Set((holders || []).map((h) => h.linked_story_id as string));

  // The rows asked about, read once.
  const asked = [...askedPosts, ...askedStories];
  const { data: askedRows, error: askErr } = await admin.from("creative_uploads").select(ROW_COLUMNS).in("id", asked);
  if (askErr) return NextResponse.json({ error: askErr.message }, { status: 500 });
  const byId = new Map(((askedRows || []) as Row[]).map((r) => [r.id, r]));

  // Posts to place: the ones asked about, and — when Stories were just
  // uploaded — the client's other waiting posts too, because a Story can
  // arrive a day before its post or a day after it (the Story-first case).
  const settled = new Map<string, Pair>();
  const toPlace: Row[] = [];
  for (const id of askedPosts) {
    const r = byId.get(id);
    if (!r || r.client_id !== clientId) { settled.set(id, { postId: id, storyId: null, confidence: null, note: "not found for this client" }); continue; }
    if (!POST_KINDS.includes(r.content_type)) { settled.set(id, { postId: id, storyId: null, confidence: null, note: "not a post, reel or carousel" }); continue; }
    if (r.linked_story_id) { settled.set(id, { postId: id, storyId: r.linked_story_id, confidence: null, note: "already has a Story" }); continue; }
    if (r.status === "scheduled") { settled.set(id, { postId: id, storyId: null, confidence: null, note: "already scheduled" }); continue; }
    toPlace.push(r);
  }
  if (askedStories.length > 0 && toPlace.length < MAX_POSTS) {
    const { data: waitingPosts } = await admin
      .from("creative_uploads")
      .select(ROW_COLUMNS)
      .eq("client_id", clientId)
      .eq("status", "uploaded")
      .in("content_type", POST_KINDS)
      .is("linked_story_id", null)
      .order("created_at", { ascending: false })
      .limit(MAX_POSTS);
    for (const r of (waitingPosts || []) as Row[]) {
      if (toPlace.length >= MAX_POSTS) break;
      if (!toPlace.some((p) => p.id === r.id) && !settled.has(r.id)) toPlace.push(r);
    }
  }

  // Candidate Stories: the ones asked about, plus the client's Stories still
  // waiting for a post (the post-first case). A festival Story schedules
  // itself and is never a candidate; a held one is never offered twice.
  const candidates: Row[] = [];
  const isFree = (r: Row) =>
    r.client_id === clientId && r.content_type === "story" && !r.festival_id && r.status !== "scheduled" && !held.has(r.id);
  for (const id of askedStories) {
    const r = byId.get(id);
    if (r && isFree(r)) candidates.push(r);
  }
  if (candidates.length < MAX_STORIES) {
    const { data: waitingStories } = await admin
      .from("creative_uploads")
      .select(ROW_COLUMNS)
      .eq("client_id", clientId)
      .eq("status", "uploaded")
      .eq("content_type", "story")
      .is("festival_id", null)
      .order("created_at", { ascending: false })
      .limit(MAX_STORIES * 2);
    for (const r of (waitingStories || []) as Row[]) {
      if (candidates.length >= MAX_STORIES) break;
      if (isFree(r) && !candidates.some((c) => c.id === r.id)) candidates.push(r);
    }
  }

  // Nothing to compare — say so per post without spending a single call.
  if (toPlace.length === 0 || candidates.length === 0) {
    for (const p of toPlace) settled.set(p.id, { postId: p.id, storyId: null, confidence: null, note: "no waiting Stories to compare" });
    const pairs = [...askedPosts.map((id) => settled.get(id)!), ...toPlace.filter((p) => !askedPosts.includes(p.id)).map((p) => settled.get(p.id)!)];
    return NextResponse.json({ success: true, pairs: pairs.filter(Boolean) });
  }

  // Each Story is read and shrunk once for every sheet. One that will not
  // decode sits out the looking and waits for a person.
  const readable: Array<{ row: Row; tile: Buffer }> = [];
  await mapLimit(candidates, CONCURRENCY, async (s) => {
    try {
      readable.push({ row: s, tile: await tile(await pictureOf(s), TILE_W, TILE_H) });
    } catch (err: unknown) {
      console.warn(`story-match: story "${s.file_name}" unreadable — left for a person:`, err instanceof Error ? err.message : err);
    }
  });
  // Candidate order, not finish order, so "#3" means the same Story on every sheet.
  readable.sort((a, b) => candidates.indexOf(a.row) - candidates.indexOf(b.row));
  const cols = readable.length <= 5 ? Math.max(1, readable.length) : 5;

  type Claim = { postId: string; idx: number | null; confidence: "high" | "low" | null; note: string };
  const claims: Claim[] = await mapLimit(toPlace, CONCURRENCY, async (p): Promise<Claim> => {
    if (readable.length === 0) return { postId: p.id, idx: null, confidence: null, note: "no readable Stories to compare" };
    try {
      const raw = await completeVision({
        purpose: "story-match",
        model: MODEL_FAST,
        maxTokens: 200,
        system: MATCH_SYSTEM,
        prompt: matchPrompt(readable.length, cols),
        imageDataUrl: await buildSheet(await pictureOf(p), readable.map((r) => r.tile), cols),
      });
      const ans = safeJsonParse<{ answer?: unknown; confidence?: unknown; reason?: unknown }>(raw, {});
      const n = typeof ans.answer === "number" ? ans.answer : Number(String(ans.answer ?? "").replace(/^#/, ""));
      const conf = ans.confidence === "high" ? "high" : ans.confidence === "low" ? "low" : null;
      const idx = Number.isInteger(n) && n >= 1 && n <= readable.length ? n - 1 : null;
      return { postId: p.id, idx, confidence: idx === null ? null : conf, note: String(ans.reason || "").slice(0, 200) };
    } catch (err: unknown) {
      return { postId: p.id, idx: null, confidence: null, note: `could not read: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // Uniqueness. Only a high-confidence answer can claim a Story at all; a Story
  // claimed by exactly one post goes to it. Claimed by two, neither gets it —
  // there is no fair way to pick between two certain answers, and a coin toss
  // is how the wrong Story ends up live beside a post.
  const claimants = new Map<number, string[]>();
  for (const c of claims) {
    if (c.idx === null || c.confidence !== "high") continue;
    claimants.set(c.idx, [...(claimants.get(c.idx) || []), c.postId]);
  }
  for (const c of claims) {
    let storyId: string | null = null;
    let note = c.note;
    if (c.idx !== null && c.confidence === "high") {
      if ((claimants.get(c.idx) || []).length === 1) storyId = readable[c.idx].row.id;
      else note = "another post claimed the same Story — link by hand";
    } else if (c.idx !== null) {
      note = `unsure (thought #${c.idx + 1}) — link by hand`;
    }
    if (storyId) {
      // Written only over an empty link — a post that got its Story by hand
      // while the matcher was looking keeps that one. The unique index catches
      // a Story someone linked elsewhere in the meantime.
      const { data: wrote, error } = await admin
        .from("creative_uploads")
        .update({ linked_story_id: storyId, story_link_source: "auto" })
        .eq("id", c.postId)
        .is("linked_story_id", null)
        .select("id");
      if (error) {
        note = error.code === UNIQUE_VIOLATION ? "that Story was linked to another post meanwhile — left as it is" : `could not save: ${error.message}`;
        storyId = null;
      } else if (!wrote || wrote.length === 0) {
        note = "a Story was linked by hand while matching — kept that one";
        storyId = null;
      }
    }
    settled.set(c.postId, { postId: c.postId, storyId, confidence: storyId ? "high" : c.confidence, note });
  }

  const order = [...askedPosts, ...toPlace.map((p) => p.id).filter((id) => !askedPosts.includes(id))];
  const pairs = order.map((id) => settled.get(id)).filter((p): p is Pair => !!p);
  return NextResponse.json({ success: true, pairs });
}
