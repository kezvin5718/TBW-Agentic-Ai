import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadImageToDrive, isDriveConnected } from "@/lib/google-drive";

/**
 * Supabase Storage is a delivery counter, not an archive.
 *
 * Files land there only because an outside service has to fetch bytes from a
 * plain public URL — Higgsfield importing a reference image, RecurPost/Meta
 * collecting a video. Google Drive is where things actually live. This moves
 * each file to Drive once nobody needs to fetch it any more, rewrites whatever
 * pointed at it, and frees the Supabase copy.
 *
 * Nothing is deleted without being archived first, and nothing is archived
 * while a post that still has to go out depends on it.
 */

const BUCKET = "studio-outputs";
const REF_ROOT = "TBW Image Studio References";
const PUBLISHED_ROOT = "TBW Published Social";

export interface SweepResult {
  scanned: number;
  archived: number;
  freedBytes: number;
  skipped: string[];
  errors: string[];
  dryRun: boolean;
}

const empty = (dryRun: boolean): SweepResult => ({ scanned: 0, archived: 0, freedBytes: 0, skipped: [], errors: [], dryRun });

const isSupabaseUrl = (u?: string | null) => !!u && u.includes("/storage/v1/object/public/");
const pathFromUrl = (u: string) => u.split(`/${BUCKET}/`)[1]?.split("?")[0] || null;
const monthOf = (iso: string) => iso.slice(0, 7);

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Higgsfield reference images. These exist purely so Higgsfield can fetch the
 * image once during import — after that the generation refers to Higgsfield's
 * own media id. But Image Studio still shows the reference next to each past
 * generation, so the ones still pointed at get moved to Drive and re-pointed
 * rather than dropped.
 */
export async function sweepStudioReferences(opts: { dryRun?: boolean; minAgeHours?: number } = {}): Promise<SweepResult> {
  const dryRun = !!opts.dryRun;
  const minAgeHours = opts.minAgeHours ?? 24;
  const out = empty(dryRun);

  const admin = createServiceRoleClient();
  const driveUp = await isDriveConnected();

  const { data: files, error } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) {
    out.errors.push(`Could not list storage: ${error.message}`);
    return out;
  }

  const cutoff = Date.now() - minAgeHours * 3600_000;

  for (const f of files || []) {
    if (!f.name.startsWith("ref-")) continue;
    out.scanned++;

    // Leave anything still being used by an in-flight generation alone.
    const created = f.created_at ? new Date(f.created_at).getTime() : 0;
    if (created > cutoff) { out.skipped.push(`${f.name} (too recent)`); continue; }

    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl;
    const size = Number((f.metadata as { size?: number } | null)?.size || 0);

    const { data: users } = await admin
      .from("studio_generations")
      .select("id, created_at")
      .like("reference_image_url", `%${f.name}`);

    if (users && users.length > 0) {
      // Still shown in Image Studio history — archive to Drive and re-point.
      if (!driveUp) { out.skipped.push(`${f.name} (still in use, Drive not connected)`); continue; }
      if (dryRun) { out.archived++; out.freedBytes += size; continue; }

      const buf = await fetchBytes(publicUrl);
      if (!buf) { out.errors.push(`${f.name}: could not read from storage`); continue; }
      try {
        const { viewUrl } = await uploadImageToDrive(
          buf, f.name, "image/jpeg", undefined, monthOf(users[0].created_at || new Date().toISOString()), REF_ROOT
        );
        await admin.from("studio_generations").update({ reference_image_url: viewUrl }).like("reference_image_url", `%${f.name}`);
        await admin.storage.from(BUCKET).remove([f.name]);
        out.archived++;
        out.freedBytes += size;
      } catch (err) {
        out.errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    // Nothing points at it — Higgsfield already imported it. Pure transit.
    if (dryRun) { out.archived++; out.freedBytes += size; continue; }
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([f.name]);
    if (rmErr) out.errors.push(`${f.name}: ${rmErr.message}`);
    else { out.archived++; out.freedBytes += size; }
  }

  return out;
}

/**
 * Social Publisher media. Safe to clear once every post using the file has
 * actually gone out — which is NOT the same as "we sent it to RecurPost":
 * RecurPost fetches the video at publish time, so a post scheduled three weeks
 * out still needs its URL alive. One publish also creates a row per platform
 * sharing one file, so a file is only released when ALL of its rows are done.
 */
export async function sweepPublishedSocialMedia(opts: { dryRun?: boolean; graceDays?: number } = {}): Promise<SweepResult> {
  const dryRun = !!opts.dryRun;
  const graceDays = opts.graceDays ?? 14;
  const out = empty(dryRun);

  const admin = createServiceRoleClient();
  const driveUp = await isDriveConnected();

  const { data: posts, error } = await admin
    .from("social_posts")
    .select("id, client_id, media_url, thumbnail_url, status, scheduled_for, created_at, clients(name)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    out.errors.push(`Could not read posts: ${error.message}`);
    return out;
  }

  const graceCutoff = Date.now() - graceDays * 86400_000;
  // When the post actually reached the platform (scheduled posts fire later).
  const wentOutAt = (p: { scheduled_for: string | null; created_at: string }) =>
    new Date(p.scheduled_for || p.created_at).getTime();

  // Group the rows by the file they share.
  const byUrl = new Map<string, typeof posts>();
  for (const p of posts || []) {
    if (!isSupabaseUrl(p.media_url)) continue;
    const list = byUrl.get(p.media_url) || [];
    list.push(p);
    byUrl.set(p.media_url, list as typeof posts);
  }

  for (const [url, rows] of byUrl) {
    out.scanned++;
    const path = pathFromUrl(url);
    if (!path) { out.errors.push(`Unrecognised storage URL: ${url.slice(0, 60)}`); continue; }

    // Every row sharing this file must have gone out cleanly, and be past grace.
    const blocking = rows.find((p) => p.status !== "sent" || wentOutAt(p) > graceCutoff);
    if (blocking) {
      out.skipped.push(
        blocking.status !== "sent"
          ? `${path} (a post using it is ${blocking.status})`
          : `${path} (still inside the ${graceDays}-day window)`
      );
      continue;
    }

    const size = await (async () => {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const base = path.slice(path.lastIndexOf("/") + 1);
      const { data } = await admin.storage.from(BUCKET).list(dir, { search: base });
      return Number((data?.[0]?.metadata as { size?: number } | null)?.size || 0);
    })();

    if (dryRun) { out.archived++; out.freedBytes += size; continue; }

    // Videos mirrored from Content Hub are already in Drive — just release the
    // copy. Anything uploaded straight into the composer has no archive yet.
    const alreadyInDrive = path.includes("/drive-");
    if (!alreadyInDrive) {
      if (!driveUp) { out.skipped.push(`${path} (Drive not connected — keeping it)`); continue; }
      const buf = await fetchBytes(url);
      if (!buf) { out.errors.push(`${path}: could not read from storage`); continue; }
      const client = (rows[0] as unknown as { clients?: { name?: string } }).clients?.name;
      const name = path.slice(path.lastIndexOf("/") + 1);
      const mime = /\.(mp4|mov|webm|mkv)$/i.test(name) ? "video/mp4" : "image/jpeg";
      try {
        const { viewUrl } = await uploadImageToDrive(
          buf, name, mime, client, monthOf(rows[0].created_at), PUBLISHED_ROOT
        );
        await admin.from("social_posts").update({ media_url: viewUrl }).eq("media_url", url);
      } catch (err) {
        out.errors.push(`${path}: Drive archive failed — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
    if (rmErr) out.errors.push(`${path}: ${rmErr.message}`);
    else { out.archived++; out.freedBytes += size; }
  }

  return out;
}

export async function sweepAll(opts: { dryRun?: boolean } = {}) {
  const references = await sweepStudioReferences(opts);
  const social = await sweepPublishedSocialMedia(opts);
  return {
    references,
    social,
    freedBytes: references.freedBytes + social.freedBytes,
    dryRun: !!opts.dryRun,
  };
}
