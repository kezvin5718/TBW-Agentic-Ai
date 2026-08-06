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
