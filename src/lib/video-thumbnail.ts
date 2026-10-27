import sharp from "sharp";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeWebStream } from "stream/web";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { downloadDriveFileToPath, storeContentHubUpload } from "@/lib/google-drive";
import { isDriveUrl } from "@/lib/publishable-media";

/**
 * Every video gets a real frame as its thumbnail, chosen by arithmetic.
 *
 * Founder's rule (27 Oct): a designer's cover, or one the matcher paired by
 * sight, always wins — an automatic frame only ever fills an empty slot, and is
 * never written over one. When nothing better exists the automatic frame IS the
 * published cover: automation already sends `thumbnail_url` as the cover, so
 * filling the column is the whole publishing change.
 *
 * No AI anywhere in here. Eight frames are pulled from across the clip and
 * judged with sharp: too dark, too bright or too flat is a fade, a black logo
 * sting or a white flash, and is thrown out; of what is left, the sharpest
 * frame with real contrast wins. If every frame is thrown out the 44% frame is
 * used anyway — still a real frame of this video, never a blank.
 */

/** Past this a video is refused rather than downloaded. */
export const MAX_THUMB_VIDEO_BYTES = 1.5 * 1024 * 1024 * 1024;
/** A broken file is tried this many times, then left showing "no thumbnail". */
const MAX_ATTEMPTS = 3;
/** Where across the clip the candidates are taken. */
const CANDIDATE_POINTS = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92];
/** The 44% frame — what is used when every candidate is rejected. */
const FALLBACK_INDEX = 3;
/** The thumbnail's long side, at most. Smaller videos are never upscaled. */
const LONG_SIDE = 1080;

// --- Process plumbing ------------------------------------------------------------
//
// The same spawn-and-collect helper creative-reader and the matcher use, with
// one addition: a deadline. The queue below runs one job at a time, so a single
// ffmpeg hung on a corrupt file would otherwise stall every thumbnail behind it.

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} took longer than ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    p.stdout.on("data", (d) => { if (out.length < 1_000_000) out += String(d); });
    p.stderr.on("data", (d) => { err = (err + String(d)).slice(-2000); });
    p.on("close", (c) => {
      clearTimeout(timer);
      if (c === 0) resolve(out);
      else reject(new Error(`${cmd} failed (${c}): ${err.slice(-160)}`));
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * One heavy job at a time, across every caller in this process — the upload's
 * fire-and-forget, the cron sweep, the kick endpoint and Compose's from-url all
 * share it. A thumbnail is a download plus nine ffmpeg runs; four of those on a
 * 400MB reel at once is how the container runs out of room.
 *
 * Held on globalThis because route handlers and instrumentation are bundled
 * separately — a module-level variable would give each its own queue.
 */
const QUEUE_KEY = Symbol.for("tbw.videoThumbQueue");
const INFLIGHT_KEY = Symbol.for("tbw.videoThumbInflight");
const SWEEP_KEY = Symbol.for("tbw.videoThumbSweeping");
const store = globalThis as unknown as Record<symbol, unknown>;
store[INFLIGHT_KEY] ??= new Set<string>();
const inflight = store[INFLIGHT_KEY] as Set<string>;

function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const prev = (store[QUEUE_KEY] as Promise<unknown> | undefined) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  store[QUEUE_KEY] = next.catch(() => {});
  return next;
}

// --- Fetch to disk -----------------------------------------------------------------

/**
 * The video, streamed to a file — never held whole in memory.
 *
 * Drive files go through the Drive API (the same route the QC check uses, as a
 * stream): an lh3 link answers a video with a JPEG poster, not the video, so a
 * Drive failure is a failure, never a fallback to fetching that link.
 */
async function fetchVideoToFile(url: string, dest: string): Promise<number> {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)}MB`;
  if (isDriveUrl(url)) {
    const r = await downloadDriveFileToPath(url, dest, MAX_THUMB_VIDEO_BYTES);
    if (!r.ok) throw new Error(r.error);
    return r.bytes;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`could not fetch the video (${res.status})`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_THUMB_VIDEO_BYTES) {
    throw new Error(`video is ${mb(declared)} — over the ${mb(MAX_THUMB_VIDEO_BYTES)} thumbnail limit`);
  }
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_THUMB_VIDEO_BYTES) cb(new Error(`video is over the ${mb(MAX_THUMB_VIDEO_BYTES)} thumbnail limit`));
      else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as unknown as NodeWebStream), counter, createWriteStream(dest));
  return bytes;
}

// --- Probe -------------------------------------------------------------------------

interface Probe {
  duration: number;
  /** As displayed: rotation and non-square pixels already applied. */
  width: number;
  height: number;
  aspect: string;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** "9:16", "4:5", "1:1" or "16:9" when the shape is one of those, else its own W:H. */
function aspectLabel(w: number, h: number): string {
  const ratio = w / h;
  const named: Array<[string, number]> = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9]];
  let best = named[0];
  for (const n of named) if (Math.abs(Math.log(ratio / n[1])) < Math.abs(Math.log(ratio / best[1]))) best = n;
  // Within 4% is that shape — an editor's 1080x1918 is still a 9:16 reel.
  if (Math.abs(Math.log(ratio / best[1])) <= 0.04) return best[0];
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
}

async function probeVideo(path: string): Promise<Probe> {
  const out = await run(
    "ffprobe",
    [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation:format=duration",
      "-of", "json", path,
    ],
    60_000
  );
  const j = JSON.parse(out || "{}") as {
    streams?: Array<{
      width?: number; height?: number; duration?: string; sample_aspect_ratio?: string;
      tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }>;
    }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  if (!s || !s.width || !s.height) throw new Error("no video stream in the file");

  // Non-square pixels: the stored width is not the shown width.
  let w = s.width;
  let h = s.height;
  const [sn, sd] = String(s.sample_aspect_ratio || "1:1").split(":").map(Number);
  if (sn > 0 && sd > 0 && sn !== sd) w = Math.round((w * sn) / sd);
  // A phone video stored sideways is shown upright; ffmpeg turns the frames
  // the same way when it decodes, so the box follows the rotation.
  const rotation = Number(s.tags?.rotate ?? s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  if (Math.abs(rotation) % 180 === 90) [w, h] = [h, w];

  const duration = Number(j.format?.duration) || Number(s.duration) || 0;
  return { duration, width: w, height: h, aspect: aspectLabel(w, h) };
}

// --- Candidates and scoring ----------------------------------------------------------

interface Scored { t: number; jpeg: Buffer; mean: number; contrast: number; sharpness: number; rejected: boolean; score: number }

/**
 * sharp does the judging, no model involved:
 *   brightness = mean of the greyscale frame, contrast = its standard deviation,
 *   sharpness  = standard deviation of a Laplacian of it.
 * The Laplacian is run with a mid-grey offset so its negative half survives
 * the 0–255 range instead of being clipped to black — otherwise half of every
 * edge would be thrown away before it was measured.
 */
async function scoreFrame(jpeg: Buffer, t: number): Promise<Scored> {
  const { data, info } = await sharp(jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: info.channels } } as const;
  const tone = (await sharp(data, raw).stats()).channels[0];
  const edges = (
    await sharp(data, raw)
      // scale 1 said outright: the default is the kernel's sum, which for a
      // Laplacian is 0.
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
      .stats()
  ).channels[0];
  const mean = tone.mean;
  const contrast = tone.stdev;
  const sharpness = edges.stdev;
  // Black, white, flat or mid-fade: not a cover, whatever its sharpness.
  const rejected = mean < 28 || mean > 232 || contrast < 14;
  const score = sharpness * Math.min(contrast / 40, 1);
  return { t, jpeg, mean, contrast, sharpness, rejected, score };
}

/** Where to take the candidates: inside 0.2s..duration-0.2s, so a short clip still gives real frames. */
function candidateTimes(duration: number): number[] {
  if (!(duration > 0)) return [1, 0];
  if (duration < 0.4) return [duration / 2];
  return CANDIDATE_POINTS.map((p) => Math.min(duration - 0.2, Math.max(0.2, duration * p)));
}

/** The video's own shape, long side at most 1080, never enlarged and never stretched. */
function outputSize(p: Probe): { w: number; h: number } {
  const scale = Math.min(1, LONG_SIDE / Math.max(p.width, p.height));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { w: even(p.width * scale), h: even(p.height * scale) };
}

async function grabFrame(video: string, t: number, size: { w: number; h: number }, out: string): Promise<Buffer> {
  await run(
    "ffmpeg",
    ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${size.w}:${size.h}:flags=lanczos,setsar=1`, "-q:v", "2", out],
    90_000
  );
  const buf = await readFile(out);
  if (buf.length === 0) throw new Error("empty frame");
  return buf;
}

interface Picked { jpeg: Buffer; probe: Probe; t: number; how: "scored" | "fallback" }

/**
 * Steps 3–5 on a video already on disk: probe it, pull the candidates, score
 * them, pick one. `onProbe` lets the caller record the duration and shape
 * before the frame work, so a file whose frames won't decode still says what
 * it is.
 */
async function pickBestFrame(video: string, dir: string, onProbe?: (p: Probe) => Promise<void>): Promise<Picked> {
  const probe = await probeVideo(video);
  if (onProbe) await onProbe(probe);
  const size = outputSize(probe);
  const times = candidateTimes(probe.duration);

  const scored: Array<Scored | null> = [];
  for (let i = 0; i < times.length; i++) {
    try {
      const jpeg = await grabFrame(video, times[i], size, join(dir, `c${i}.jpg`));
      scored.push(await scoreFrame(jpeg, times[i]));
    } catch {
      scored.push(null); // one frame that won't decode is not the whole video
    }
  }
  const got = scored.filter((s): s is Scored => !!s);
  if (got.length === 0) throw new Error("no frame could be read from the video");

  const keepers = got.filter((s) => !s.rejected);
  if (keepers.length > 0) {
    const best = keepers.reduce((a, b) => (b.score > a.score ? b : a));
    return { jpeg: best.jpeg, probe, t: best.t, how: "scored" };
  }
  // Every frame was a fade or a flat colour. The 44% frame is still this
  // video's own picture — and if that one would not decode, the nearest that did.
  const target = times[Math.min(FALLBACK_INDEX, times.length - 1)];
  const fallback = scored[FALLBACK_INDEX] || got.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a));
  return { jpeg: fallback.jpeg, probe, t: fallback.t, how: "fallback" };
}

// --- Store -------------------------------------------------------------------------

const stemOf = (name: string) =>
  (name.split("/").pop() || "video").replace(/\?.*$/, "").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "video";

/** Same home as the video: "TBW Content Hub / {client} / {month}" on Drive, Supabase if Drive is down. */
async function storeThumb(jpeg: Buffer, stem: string, clientName?: string, monthLabel?: string): Promise<{ url: string; name: string }> {
  const name = `${stem}-thumb.jpg`;
  // Prefixed in storage, as every hub upload is — two reels both called
  // "final.mp4" must not land on one Supabase path. The record keeps the plain name.
  const url = await storeContentHubUpload(jpeg, `${Date.now()}-${name}`, "image/jpeg", clientName, monthLabel);
  if (!url) throw new Error("could not store the thumbnail (Drive and Supabase both refused it)");
  return { url, name };
}

/**
 * Only URLs our own storage handed out are fetched — the same fence the cover
 * matcher uses, so from-url can never be told to fetch an arbitrary address.
 */
export function isOurStorageUrl(url: string): boolean {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return false;
  if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) return true;
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!sb && url.startsWith(sb);
}

// --- The engine --------------------------------------------------------------------

export interface ThumbOutcome {
  id: string;
  outcome: "completed" | "lost_race" | "failed" | "skipped";
  note?: string;
}

/**
 * Make the thumbnail for one creative_uploads row.
 *
 * Safe to call any number of times from anywhere: the claim is a single
 * conditional UPDATE, so of two callers racing for one row exactly one gets it
 * and the other returns quietly. Never throws — it is fired without being
 * awaited right after an upload, and an unhandled rejection there would take
 * the server down.
 */
export function generateThumbnailFor(uploadId: string): Promise<ThumbOutcome> {
  return oneAtATime(() => generateNow(uploadId)).catch((err: unknown) => ({
    id: uploadId,
    outcome: "failed" as const,
    note: err instanceof Error ? err.message : String(err),
  }));
}

async function generateNow(id: string): Promise<ThumbOutcome> {
  const admin = createServiceRoleClient();

  // 1. Claim. The read only tells us which attempt this would be; the UPDATE
  // is what decides, matching on that same attempt count, so a second claimer
  // that read the same number finds nothing left to match. Everything after
  // this is keyed by the claimed id alone.
  const { data: cur } = await admin
    .from("creative_uploads")
    .select("id, media_type, thumbnail_url, thumbnail_status, thumbnail_attempts")
    .eq("id", id)
    .maybeSingle();
  const attempts = Number(cur?.thumbnail_attempts || 0);
  if (
    !cur || cur.media_type !== "video" || cur.thumbnail_url ||
    !["pending", "failed"].includes(String(cur.thumbnail_status)) || attempts >= MAX_ATTEMPTS
  ) {
    return { id, outcome: "skipped", note: "not waiting for a thumbnail" };
  }

  inflight.add(id);
  let dir: string | null = null;
  try {
    const { data: row } = await admin
      .from("creative_uploads")
      .update({ thumbnail_status: "processing", thumbnail_attempts: attempts + 1 })
      .eq("id", id)
      .eq("media_type", "video")
      .is("thumbnail_url", null)
      .in("thumbnail_status", ["pending", "failed"])
      .eq("thumbnail_attempts", attempts)
      .lt("thumbnail_attempts", MAX_ATTEMPTS)
      .select("id, file_url, file_name, created_at, client_id, festival_id, clients(name)")
      .maybeSingle();
    if (!row) return { id, outcome: "skipped", note: "claimed elsewhere, or already done" };

    try {
      // 2. Fetch to a temp file, streamed.
      dir = await mkdtemp(join(tmpdir(), "vthumb-"));
      const video = join(dir, "in.video");
      await fetchVideoToFile(row.file_url as string, video);

      // 3–5. Probe, candidates, score.
      const picked = await pickBestFrame(video, dir, async (p) => {
        await admin
          .from("creative_uploads")
          .update({ video_duration: p.duration > 0 ? Number(p.duration.toFixed(3)) : null, video_aspect_ratio: p.aspect })
          .eq("id", id);
      });

      // 6. Store beside the video. A festival creative with no client yet
      // lives under "Festivals", as its video does.
      const clientName =
        (row.clients as { name?: string } | null)?.name || (!row.client_id && row.festival_id ? "Festivals" : undefined);
      const monthLabel = String(row.created_at || new Date().toISOString()).slice(0, 7);
      const stored = await storeThumb(picked.jpeg, stemOf(String(row.file_name || "video")), clientName, monthLabel);

      // 7. Commit — only into an empty slot. A designer or matched cover that
      // landed while this ran is never overwritten; the frame just made is
      // left where it is rather than deleted.
      const { data: won, error: commitErr } = await admin
        .from("creative_uploads")
        .update({
          thumbnail_url: stored.url,
          thumbnail_name: stored.name,
          thumbnail_source: "auto",
          thumbnail_status: "completed",
          thumbnail_generated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("thumbnail_url", null)
        .select("id")
        .maybeSingle();
      if (commitErr) throw new Error(`could not save the thumbnail: ${commitErr.message}`);
      if (!won) {
        await admin
          .from("creative_uploads")
          .update({ thumbnail_status: "completed" })
          .eq("id", id)
          .not("thumbnail_url", "is", null);
        return { id, outcome: "lost_race", note: "a cover arrived while this ran — it was kept" };
      }
      return {
        id,
        outcome: "completed",
        note: `${picked.how === "scored" ? "best" : "fallback"} frame at ${picked.t.toFixed(2)}s`,
      };
    } catch (err: unknown) {
      // 8. Failed — retried later while attempts remain. The video is never
      // touched; only an empty, still-processing row is marked.
      const note = err instanceof Error ? err.message : String(err);
      console.warn(`video thumbnail ${id}: attempt ${attempts + 1} of ${MAX_ATTEMPTS} failed — ${note}`);
      await admin
        .from("creative_uploads")
        .update({ thumbnail_status: "failed" })
        .eq("id", id)
        .is("thumbnail_url", null)
        .eq("thumbnail_status", "processing");
      return { id, outcome: "failed", note };
    }
  } finally {
    inflight.delete(id);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface SweepResult { busy: boolean; picked: number; completed: number; failed: number; skipped: number; recovered: number }

/**
 * Drain the queue: the oldest videos still waiting (pending, or failed with
 * attempts left), strictly one at a time. Used by the cron every 5 minutes and
 * by the Content Hub's kick. A second sweep arriving while one runs returns at
 * once rather than stacking up behind it.
 */
export async function processPendingThumbnails(limit: number): Promise<SweepResult> {
  const result: SweepResult = { busy: false, picked: 0, completed: 0, failed: 0, skipped: 0, recovered: 0 };
  if (store[SWEEP_KEY]) return { ...result, busy: true };
  store[SWEEP_KEY] = true;
  try {
    const admin = createServiceRoleClient();

    // A deploy or restart mid-job leaves a row "processing" that nobody is
    // working on, and the claim only takes pending or failed — it would wait
    // forever. Anything processing that this server is not actually running
    // goes back to failed, its attempt already counted.
    const { data: stuck } = await admin
      .from("creative_uploads")
      .select("id")
      .eq("media_type", "video")
      .eq("thumbnail_status", "processing")
      .is("thumbnail_url", null)
      .limit(50);
    for (const s of stuck || []) {
      if (inflight.has(s.id as string)) continue;
      await admin.from("creative_uploads").update({ thumbnail_status: "failed" }).eq("id", s.id).eq("thumbnail_status", "processing");
      result.recovered++;
    }

    // A video recorded by a path that never set a status (or before the
    // backfill was queued) is waiting all the same.
    await admin
      .from("creative_uploads")
      .update({ thumbnail_status: "pending" })
      .eq("media_type", "video")
      .is("thumbnail_status", null)
      .is("thumbnail_url", null);

    const { data: rows } = await admin
      .from("creative_uploads")
      .select("id")
      .eq("media_type", "video")
      .is("thumbnail_url", null)
      .in("thumbnail_status", ["pending", "failed"])
      .lt("thumbnail_attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(Math.max(1, Math.min(limit, 20)));

    for (const r of rows || []) {
      result.picked++;
      const out = await generateThumbnailFor(r.id as string);
      if (out.outcome === "completed" || out.outcome === "lost_race") result.completed++;
      else if (out.outcome === "failed") result.failed++;
      else result.skipped++;
    }
    return result;
  } finally {
    store[SWEEP_KEY] = false;
  }
}

/**
 * Steps 2–6 on a bare URL, for Compose's direct uploads — nothing is recorded
 * on any row; the caller gets the stored frame back and decides what to do.
 * Runs in the same one-at-a-time queue as everything else.
 */
export function thumbnailFromUrl(url: string, clientName?: string): Promise<{ url: string; name: string }> {
  return oneAtATime(async () => {
    const dir = await mkdtemp(join(tmpdir(), "vthumb-"));
    try {
      const video = join(dir, "in.video");
      await fetchVideoToFile(url, video);
      const picked = await pickBestFrame(video, dir);
      return await storeThumb(picked.jpeg, stemOf(url), clientName, new Date().toISOString().slice(0, 7));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
