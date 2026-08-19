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
 * A designer's cover arrives at print resolution — the Swarna Kanchi reel used a
 * 4500x5625, 12MB JPEG — and Meta re-encodes anything that large to its own
 * cover size on the way in. That re-encode is the softness.
 *
 * So do that resize ourselves, once, properly. Only the resolution changes:
 * the frame the designer composed is never cropped or re-shaped, because a 4:5
 * cover is a deliberate choice and cropping it to a reel's 9:16 would throw
 * away the part of the design they placed there. The image is fitted inside the
 * largest sensible box with its aspect ratio intact.
 */
export async function toPublishableThumbUrl(
  url: string
): Promise<{ url: string; note?: string }> {
  const MAX_BYTES = 2 * 1024 * 1024;

  try {
    const sharp = (await import("sharp")).default;
    const admin = createServiceRoleClient();

    const buf = isDriveUrl(url)
      ? await downloadDriveFileByUrl(url)
      : Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
    if (!buf || buf.length === 0) return { url };

    const meta = await sharp(buf).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (!w || !h) return { url };

    // Only oversized covers are touched; a correctly sized one is passed
    // through untouched rather than re-encoded for no reason.
    const tooBig = buf.length > MAX_BYTES || w > 1440 || h > 1920;
    if (!tooBig) return { url };

    // "inside" scales down to fit the box and keeps the aspect ratio exactly —
    // a 4:5 cover stays 4:5, a 9:16 one stays 9:16. Nothing is ever cropped.
    const resized = await sharp(buf)
      .resize({ width: 1080, height: 1920, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    const out = await sharp(resized).metadata();

    const path = `social/thumb-${Date.now()}-${out.width}x${out.height}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, resized, { contentType: "image/jpeg", upsert: true });
    if (error) return { url };

    return {
      url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      note: `Cover resized from ${w}x${h} (${(buf.length / 1024 / 1024).toFixed(1)}MB) to ${out.width}x${out.height} (${(resized.length / 1024).toFixed(0)}KB) — same aspect ratio, no crop — so the platform doesn't re-compress it.`,
    };
  } catch {
    // A cover that cannot be normalised is still better sent than not sent.
    return { url };
  }
}
