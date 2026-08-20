import { createServiceRoleClient } from "@/lib/supabase/server";
import { downloadDriveFileByUrl } from "@/lib/google-drive";

/**
 * Content Hub stores designer uploads on Google Drive, but a Drive link is not
 * something an outside service can fetch bytes from:
 *
 *   https://lh3.googleusercontent.com/d/<id>
 *
 * For an image, Drive serves the image — which is why photo posts publish fine.
 * For a VIDEO, that same URL serves a JPEG poster frame instead of the video,
 * so RecurPost (and Meta behind it) rejects it with
 * "URL is not a video (detected content type: image/jpeg)".
 *
 * So before publishing, any Drive-hosted video is copied once to Supabase
 * Storage, which serves raw bytes over a plain public URL. The copy is keyed by
 * the Drive file id and reused, so re-posting the same reel doesn't re-upload.
 */

const BUCKET = "studio-outputs";

export function isDriveUrl(url: string): boolean {
  return /googleusercontent\.com\/d\/|drive\.google\.com\/file\/d\//.test(url);
}

function driveIdOf(url: string): string | null {
  const m = url.match(/googleusercontent\.com\/d\/([^=/?&]+)/) || url.match(/drive\.google\.com\/file\/d\/([^/?&]+)/);
  return m ? m[1] : null;
}

/**
 * Drive doesn't tell us the type on the way out, and guessing "mp4" for a .mov
 * would make Storage serve the wrong content-type — the exact class of problem
 * this whole file exists to avoid. So read it off the container header.
 */
function sniffVideo(buf: Buffer): { mime: string; ext: string } {
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand.startsWith("qt")) return { mime: "video/quicktime", ext: "mov" };
    return { mime: "video/mp4", ext: "mp4" };
  }
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return { mime: "video/webm", ext: "webm" };
  return { mime: "video/mp4", ext: "mp4" };
}

/**
 * Returns a URL an external service can actually fetch the video from.
 * Non-Drive URLs pass straight through. Returns null only if the copy failed,
 * so the caller can report a real reason instead of publishing a broken link.
 */
export async function toPublishableVideoUrl(
  url: string
): Promise<{ url: string | null; copied: boolean; error?: string }> {
  if (!isDriveUrl(url)) return { url, copied: false };

  const id = driveIdOf(url);
  if (!id) return { url: null, copied: false, error: "Could not read the Google Drive file id from the media link." };

  const admin = createServiceRoleClient();

  // Already mirrored by an earlier post of the same file? Reuse it.
  const { data: existing } = await admin.storage.from(BUCKET).list("social", { search: `drive-${id}` });
  if (existing && existing.length > 0) {
    return { url: admin.storage.from(BUCKET).getPublicUrl(`social/${existing[0].name}`).data.publicUrl, copied: false };
  }

  const buffer = await downloadDriveFileByUrl(url);
  if (!buffer || buffer.length === 0) {
    return { url: null, copied: false, error: "Could not download the video from Google Drive — check the Drive connection in Integrations." };
  }

  const { mime, ext } = sniffVideo(buffer);
  const path = `social/drive-${id}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
  if (error) {
    return { url: null, copied: false, error: `Could not stage the video for publishing: ${error.message}` };
  }

  return { url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, copied: true };
}

/**
 * A cover image the platforms will show sharply.
 *
 * The rule is: never change the creative. Not its dimensions, not its shape,
 * not its framing. A 4500x5625 print-resolution cover is sent at 4500x5625.
 *
 * The one thing that has to be respected is the platform's upload ceiling —
 * past roughly 8MB an image is refused or brutally re-compressed on the way
 * in, and that is where the softness came from. So a cover over the ceiling is
 * re-encoded at the SAME pixel dimensions, trading a little JPEG quality for
 * file size: the 11.7MB Swarna Kanchi cover becomes 3.3MB while staying
 * 4500x5625. Scaling down is a last resort that only happens if even the
 * lowest quality step is still too heavy — and it says so when it does.
 */
export async function toPublishableThumbUrl(
  url: string
): Promise<{ url: string; note?: string }> {
  // Meta refuses images past ~8MB; staying under it is the only reason to
  // touch a cover at all.
  const MAX_BYTES = 8 * 1024 * 1024;

  try {
    const sharp = (await import("sharp")).default;
    const admin = createServiceRoleClient();

    const buf = isDriveUrl(url)
      ? await downloadDriveFileByUrl(url)
      : Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
    if (!buf || buf.length === 0) return { url };

    // Anything the platform will accept is sent exactly as the designer made
    // it — no re-encode, no resize, not a single pixel changed.
    if (buf.length <= MAX_BYTES) return { url };

    const meta = await sharp(buf).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (!w || !h) return { url };

    // Same dimensions, lighter file. Quality steps down only as far as needed.
    let out: Buffer | null = null;
    let usedQuality = 0;
    for (const quality of [92, 88, 84]) {
      const candidate = await sharp(buf).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (candidate.length <= MAX_BYTES) { out = candidate; usedQuality = quality; break; }
    }

    let scaled = false;
    if (!out) {
      // Only reachable by a cover so large that even q84 can't fit it — at
      // that point sending nothing usable is worse than sending it smaller.
      out = await sharp(buf).resize({ width: 2160, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      scaled = true;
    }

    const outMeta = await sharp(out).metadata();
    const path = `social/thumb-${Date.now()}-${outMeta.width}x${outMeta.height}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, out, { contentType: "image/jpeg", upsert: true });
    if (error) return { url };

    return {
      url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      note: scaled
        ? `Cover was ${w}x${h} at ${(buf.length / 1024 / 1024).toFixed(1)}MB — too heavy for the platform even compressed, so it went out at ${outMeta.width}x${outMeta.height}. Export it under 8MB to keep full resolution.`
        : `Cover kept at full ${outMeta.width}x${outMeta.height} — only the file was made lighter (${(buf.length / 1024 / 1024).toFixed(1)}MB → ${(out.length / 1024 / 1024).toFixed(1)}MB at quality ${usedQuality}) so the platform accepts it without re-compressing.`,
    };
  } catch {
    // A cover that cannot be normalised is still better sent than not sent.
    return { url };
  }
}
