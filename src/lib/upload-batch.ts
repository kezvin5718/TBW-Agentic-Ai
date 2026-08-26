import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * A batch stands or falls together.
 *
 * When one creative in an upload fails QC, the whole batch for that client is
 * rejected: a set delivered together is corrected and resubmitted together, and
 * letting the good half through leaves someone reconciling which of twelve
 * files still needs redoing.
 *
 * Rejected means hidden from Automation and flagged in Content Hub — never
 * deleted. QC returns "unsure" on perfectly good work often enough that
 * destroying a designer's day on one verdict is not a trade worth making, and
 * the Drive file is the only copy.
 *
 * Scope is deliberately the batch, not the client: a Monday delivery that
 * already passed is not dragged down by a Tuesday one that failed.
 */
export async function applyBatchVerdict(batchId: string | null): Promise<{ rejected: number; reason: string | null }> {
  if (!batchId) return { rejected: 0, reason: null };

  const admin = createServiceRoleClient();
  const { data: rows } = await admin
    .from("creative_uploads")
    .select("id, file_name, qc_status, qc_note, qc_detected_brand, qc_detected_festival, status")
    .eq("batch_id", batchId);

  if (!rows || rows.length === 0) return { rejected: 0, reason: null };

  // Still being checked — verdict has to wait for the whole batch.
  if (rows.some((r) => r.qc_status === "pending")) return { rejected: 0, reason: null };

  const bad = rows.find((r) => r.qc_status === "mismatch");
  if (!bad) return { rejected: 0, reason: null };

  const detected = bad.qc_detected_festival || bad.qc_detected_brand || "something else";
  const reason = `"${bad.file_name || "one creative"}" failed QC (looks like ${detected}) — the whole upload was rejected. Fix it and upload the set again.`;

  // Anything already scheduled has left this stage and is not pulled back.
  const { data: updated } = await admin
    .from("creative_uploads")
    .update({ status: "rejected", rejected_reason: reason })
    .eq("batch_id", batchId)
    .neq("status", "scheduled")
    .select("id");

  return { rejected: updated?.length || 0, reason };
}

/** What one caption attempt did, in words the screen can show. */
export interface CaptionOutcome {
  ok: boolean;
  caption?: string;
  error?: string;
}

/**
 * Writes the caption for an approved creative, once, in the background.
 *
 * The Automation screen is meant to open with captions already in place. Doing
 * this on load would mean a vision read and a caption write per creative while
 * somebody watches a spinner, so it happens as QC passes instead — by the time
 * the team opens the tab the work is done.
 *
 * Returns true when a caption was written, for callers that only count.
 */
export async function writeCaptionFor(uploadId: string): Promise<boolean> {
  return (await captionForUpload(uploadId)).ok;
}

/**
 * The same work, with the reason it did or didn't happen.
 *
 * The Automation screen asks for captions by hand now, so an empty box has to
 * be able to say why it is empty — and `force` is what makes the ✨ beside a
 * written caption mean "write me another one" rather than being ignored.
 *
 * Note what is NOT guarded here: a row left at 'failed' or 'no_contact' has an
 * empty caption and a status that is not 'done', so it is picked up and tried
 * again on its own. Only a real caption, or a row already marked done, is left
 * alone — and `force` overrides even those.
 */
export async function captionForUpload(
  uploadId: string,
  opts: { force?: boolean } = {}
): Promise<CaptionOutcome> {
  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("creative_uploads")
    .select("id, client_id, file_url, thumbnail_url, media_type, content_type, caption, caption_status, festival_id")
    .eq("id", uploadId)
    .maybeSingle();

  if (!row) return { ok: false, error: "That creative no longer exists." };
  // A Story carries no caption on either platform, and a festival creative
  // carries the line chosen for it on the Festivals board.
  if (row.festival_id) return { ok: false, error: "Festival creatives carry their own line." };
  if (row.content_type === "story" || row.content_type === "thumbnail") {
    return { ok: false, error: "A Story carries no caption." };
  }
  // A caption the designer typed is theirs, unless someone explicitly asks for
  // another one.
  if (!opts.force) {
    if (String(row.caption || "").trim()) return { ok: false, error: "This one already has a caption." };
    if (row.caption_status === "done") return { ok: false, error: "This one already has a caption." };
  }

  try {
    // Read the creative properly first — every part of a video, and the text
    // printed on it word for word. Stored, so the caption writer is handed the
    // reading instead of doing its own single-frame guess, and so a later
    // regeneration costs nothing.
    const { readCreative } = await import("@/lib/creative-reader");
    const reading = await readCreative(row.file_url, row.media_type);
    await admin
      .from("creative_uploads")
      .update({
        vision_description: reading.description || null,
        on_creative_text: reading.onCreativeText || null,
        frames_read: reading.framesRead || null,
      })
      .eq("id", uploadId);

    // Written in-process. This was an HTTP call to our own API carrying the
    // caller's cookie, and in production that hop loses the session — which is
    // the whole reason no caption was ever written in the background.
    const { writeCaptionForClient } = await import("@/lib/caption-engine");
    const written = await writeCaptionForClient({
      clientId: row.client_id,
      platform: "instagram",
      contentType: row.content_type || "post",
      mediaUrl: row.file_url,
      mediaIsVideo: row.media_type === "video",
      thumbnailUrl: row.thumbnail_url || undefined,
      visionDescription: reading.description,
      onCreativeText: reading.onCreativeText,
    });
    if (!written.ok) {
      // A missing address is a fixable gap in the brand record, not a failure of
      // this creative — it is recorded distinctly so the screen can say which
      // client needs one instead of showing an unexplained empty box.
      if (written.code === "missing_contact") {
        await admin.from("creative_uploads").update({ caption_status: "no_contact" }).eq("id", uploadId);
        console.warn(`caption for upload ${uploadId} skipped: ${written.error}`);
        return { ok: false, error: written.error || "No address or phone on file for this client." };
      }
      throw new Error(written.error || "no caption returned");
    }

    await admin
      .from("creative_uploads")
      .update({ caption: written.caption, caption_status: "done" })
      .eq("id", uploadId);
    return { ok: true, caption: written.caption };
  } catch (err: unknown) {
    // Not fatal: the Automation row simply shows an empty caption box the team
    // can fill or retry, which is where they were before this existed.
    await admin.from("creative_uploads").update({ caption_status: "failed" }).eq("id", uploadId);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`caption for upload ${uploadId} failed:`, message);
    return { ok: false, error: message };
  }
}
