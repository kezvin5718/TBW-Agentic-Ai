import { completeVision } from "@/lib/llm-vision";
import { safeJsonParse } from "@/lib/llm";
import { MODEL_CAPTIONS, MODEL_FAST, CAPTIONS_REASONING_EFFORT } from "@/lib/llm-config";
import { downloadDriveFileByUrl } from "@/lib/google-drive";
import sharp from "sharp";
import { spawn } from "child_process";
import { writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Frames sampled across a video. One cover frame misses everything after it;
 * three missed the middle of anything long. Five is the floor (start, quarter,
 * middle, three-quarter, end), and longer clips earn one more for every extra
 * twenty seconds, capped where the vision call stops getting smarter.
 */
const MIN_FRAMES = 5;
const MAX_FRAMES = 10;
const frameCountFor = (durationSeconds: number) =>
  Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.ceil(durationSeconds / 20) + 4));
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
  /**
   * What is SAID in a video — voiceover, dialogue, a presenter — transcribed in
   * the language it is spoken. Empty when the clip is music only or silent.
   */
  audioTranscript: string;
}

/** The first three minutes are plenty for a reel, and keep the clip small. */
const AUDIO_SECONDS = 180;
const NO_SPEECH = "NO_SPEECH";

/**
 * Listen to a video's soundtrack and write down what is said.
 *
 * Reels carry their message in the voiceover as often as on screen — "flat 20%
 * off this Dhanteras" is said, not printed. Bron has no Whisper key, so the
 * clip goes to Gemini through OpenRouter, which hears Hindi, Gujarati and
 * English mixed mid-sentence the way the clients actually speak.
 *
 * Never throws: a reel with no audio track, music only, or a failed call simply
 * has no transcript, and the caption is still written from the frames.
 */
async function transcribeSoundtrack(videoPath: string, base: string, made: string[]): Promise<string> {
  try {
    const streams = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", videoPath]);
    if (!streams.trim()) return "";
    const audioPath = `${base}-audio.mp3`;
    made.push(audioPath);
    // 16kHz mono — speech stays perfectly legible at a fraction of the size.
    await run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-t", String(AUDIO_SECONDS), audioPath]);
    const audio = await readFile(audioPath);
    if (audio.length < 2000) return "";
    const raw = await completeVision({
      system: "You transcribe the soundtrack of short advertising videos for an Indian jewellery agency. You write down only words that are actually spoken or sung as lyrics, never describe the music, and never guess.",
      prompt: `Transcribe every word spoken in this audio — voiceover, dialogue, a presenter — exactly as said, in the language it is spoken (Hindi, Gujarati, English or a mix; keep each in its own script). Copy prices, percentages, weights, dates and offer names exactly as heard.

If there is no speech at all — only music, sound effects or silence — reply with exactly ${NO_SPEECH} and nothing else. Do not transcribe song lyrics of background music. Output only the transcript.`,
      audioBase64: audio.toString("base64"),
      audioFormat: "mp3",
      purpose: "creative-audio",
      model: MODEL_FAST,
      maxTokens: 1500,
    });
    const text = String(raw || "").trim();
    if (!text || text.toUpperCase().includes(NO_SPEECH)) return "";
    return text.slice(0, 4000);
  } catch (err: unknown) {
    console.warn("creative reader: could not transcribe the soundtrack —", err instanceof Error ? err.message : err);
    return "";
  }
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
async function videoFrames(buf: Buffer, withAudio = false): Promise<{ frames: string[]; audioTranscript: string }> {
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
    const count = frameCountFor(dur);
    for (let i = 0; i < count; i++) {
      // Spread across the middle of the clip, skipping the very first and last
      // moments — those are usually a fade or a logo sting.
      const at = Math.min(dur - 0.2, Math.max(0.2, (dur * (i + 0.6)) / count));
      const framePath = `${base}-${i}.jpg`;
      made.push(framePath);
      try {
        await run("ffmpeg", ["-y", "-ss", String(at), "-i", inPath, "-frames:v", "1", "-q:v", "3", framePath]);
        out.push(await toDataUrl(await readFile(framePath)));
      } catch { /* a frame that will not decode is skipped, not fatal */ }
    }
    // The same file on disk serves the soundtrack — no second download.
    const audioTranscript = withAudio ? await transcribeSoundtrack(inPath, base, made) : "";
    return { frames: out, audioTranscript };
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
export async function readCreative(url: string, mediaType: string, opts: { audio?: boolean } = {}): Promise<CreativeReading> {
  const empty: CreativeReading = { description: "", onCreativeText: "", framesRead: 0, audioTranscript: "" };
  try {
    const buf = await fetchBytes(url);
    const isVideo = mediaType === "video";
    if (isVideo && buf.length > MAX_VIDEO_BYTES) {
      return { ...empty, description: "" };
    }

    const video = isVideo ? await videoFrames(buf, opts.audio === true) : null;
    const images = video ? video.frames : [await toDataUrl(buf)];
    if (images.length === 0) return { ...empty, audioTranscript: video?.audioTranscript || "" };
    const read = await readImages(images);
    return { ...read, audioTranscript: video?.audioTranscript || "" };
  } catch {
    return empty;
  }
}

/**
 * A carousel is read slide by slide and reported as one piece: every slide's
 * description in order, and every line of text from all of them. A caption
 * written from the cover alone describes one necklace out of five.
 */
export async function readCarousel(urls: string[]): Promise<CreativeReading> {
  const empty: CreativeReading = { description: "", onCreativeText: "", framesRead: 0, audioTranscript: "" };
  const slides = urls.filter(Boolean).slice(0, MAX_FRAMES);
  const images: string[] = [];
  for (const u of slides) {
    try { images.push(await toDataUrl(await fetchBytes(u))); } catch { /* one missing slide must not lose the rest */ }
  }
  if (images.length === 0) return empty;
  const read = await readImages(images, true);
  return { ...read, audioTranscript: "" };
}

/** Read each image, then merge: frames of one clip, or slides of one carousel. */
async function readImages(images: string[], asSlides = false): Promise<Omit<CreativeReading, "audioTranscript">> {
    const descriptions: string[] = [];
    const texts: string[] = [];

    for (const imageDataUrl of images) {
      try {
        // 1500 rather than the default 300: the answer is ~150 tokens, the rest
        // is room for the model's thinking so the answer is never cut off.
        const raw = await completeVision({
          system: READ_SYSTEM, prompt: READ_PROMPT, imageDataUrl, purpose: "creative-reading",
          model: MODEL_CAPTIONS, maxTokens: 1500, reasoningEffort: CAPTIONS_REASONING_EFFORT,
        });
        const v = safeJsonParse<{ description?: string; on_creative_text?: string }>(raw, {});
        if (v.description) descriptions.push(asSlides ? `Slide ${descriptions.length + 1}: ${String(v.description).trim()}` : String(v.description).trim());
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
      // A clip's longest description is its most informative frame, rather than
      // near-identical ones concatenated. A carousel's slides are different
      // pieces, so every one is kept, in order.
      description: asSlides ? descriptions.join("\n") : descriptions.sort((a, b) => b.length - a.length)[0] || "",
      onCreativeText: uniqueText,
      framesRead: images.length,
    };
}
