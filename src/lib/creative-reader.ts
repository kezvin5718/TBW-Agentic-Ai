import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import sharp from "sharp";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/** Frames sampled across a video. One cover frame misses everything after it. */
const VIDEO_FRAMES = 3;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export interface CreativeReading {
  /** Factual description of what is shown. */
  description: string;
  /**
   * Text lifted off the creative word for word — prices, weights, purity,
   * offers, phone numbers. Held separately because a caption has to reuse these
   * exactly, and inventing a price is the one unrecoverable mistake.
   */
  onCreativeText: string;
  framesRead: number;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${c}): ${err.slice(-160)}`))));
    p.on("error", reject);
  });
}

async function fetchBytes(url: string): Promise<Buffer> {
  if (/googleusercontent\.com|drive\.google\.com/.test(url)) {
    const b = await downloadDriveFileByUrl(url);
    if (b && b.length) return b;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`could not fetch the creative (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const toDataUrl = async (buf: Buffer): Promise<string> => {
  const small = await sharp(buf).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
};

/**
 * Sample frames across a video rather than taking one near the start.
 *
 * A jewellery reel opens on a logo sting and puts the price, weight and offer on
 * a card near the end. Reading a single early frame — which is what the caption
 * writer and QC both did — sees none of it.
 */
async function videoFrames(buf: Buffer): Promise<string[]> {
  const base = join(tmpdir(), `read-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const inPath = `${base}.video`;
  const made = [inPath];
  try {
    await writeFile(inPath, buf);

    let duration = 0;
    try {
      const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inPath]);
      duration = Number(String(probe).trim()) || 0;
    } catch { duration = 0; }
    const dur = duration > 1 ? duration : 8;

    const out: string[] = [];
    for (let i = 0; i < VIDEO_FRAMES; i++) {
      // Spread across the middle of the clip, skipping the very first and last
      // moments — those are usually a fade or a logo sting.
      const at = Math.min(dur - 0.2, Math.max(0.2, (dur * (i + 0.6)) / VIDEO_FRAMES));
      const framePath = `${base}-${i}.jpg`;
      made.push(framePath);
      try {
        await run("ffmpeg", ["-y", "-ss", String(at), "-i", inPath, "-frames:v", "1", "-q:v", "3", framePath]);
        out.push(await toDataUrl(await readFile(framePath)));
      } catch { /* a frame that will not decode is skipped, not fatal */ }
    }
    return out;
  } finally {
    await Promise.all(made.map((f) => rm(f, { force: true }).catch(() => {})));
  }
}

const READ_SYSTEM =
  "You read advertising creatives for a jewellery agency and report only what is actually there. You never guess, never round a number, and never describe something you cannot see. Reply with JSON only.";

const READ_PROMPT = `Look at this creative and report what it actually contains.

Return JSON exactly:
{ "description": "<what is shown: the product, its metal and stones, the setting and mood — under 60 words, factual>",
  "on_creative_text": "<EVERY piece of text visible on the creative, copied word for word, separated by ' | '. Include prices, discounts, weights, carat and purity, scheme or offer names, dates, phone numbers, addresses and any terms. Empty string if there is genuinely no text.>" }

Copy text exactly as written — "₹45,999" stays "₹45,999", "22KT 916 Hallmark" stays "22KT 916 Hallmark". Do not translate it, tidy it, round it or summarise it. If you cannot read something clearly, leave it out rather than guessing at it.`;

/**
 * Reads a creative properly: every frame of a video, and the text on it verbatim.
 *
 * This exists because captions were being written blind. The old path used the
 * thumbnail for a video and a Content Hub reel rarely has one, so `visual` came
 * back empty and the model wrote from the brand brief alone — which is how a
 * caption ends up describing a piece that is not in the video, or omitting the
 * price the creative is built around.
 */
export async function readCreative(url: string, mediaType: string): Promise<CreativeReading> {
  const empty: CreativeReading = { description: "", onCreativeText: "", framesRead: 0 };
  try {
    const buf = await fetchBytes(url);
    const isVideo = mediaType === "video";
    if (isVideo && buf.length > MAX_VIDEO_BYTES) {
      return { ...empty, description: "" };
    }

    const images = isVideo ? await videoFrames(buf) : [await toDataUrl(buf)];
    if (images.length === 0) return empty;

    const descriptions: string[] = [];
    const texts: string[] = [];

    for (const imageDataUrl of images) {
      try {
        const raw = await completeVision({ system: READ_SYSTEM, prompt: READ_PROMPT, imageDataUrl });
        const v = safeJsonParse<{ description?: string; on_creative_text?: string }>(raw, {});
        if (v.description) descriptions.push(String(v.description).trim());
        if (v.on_creative_text) texts.push(String(v.on_creative_text).trim());
      } catch { /* one unreadable frame must not lose the others */ }
    }

    // Frames of the same clip repeat themselves; the same line of text read
    // twice would otherwise look like two different offers.
    const seen = new Set<string>();
    const uniqueText = texts
      .join(" | ")
      .split("|")
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const k = s.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .join(" | ");

    return {
      // The longest description is the most informative frame, rather than three
      // near-identical ones concatenated.
      description: descriptions.sort((a, b) => b.length - a.length)[0] || "",
      onCreativeText: uniqueText,
      framesRead: images.length,
    };
  } catch {
    return empty;
  }
}
