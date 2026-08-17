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

/**
 * Writes the caption for an approved creative, once, in the background.
 *
 * The Automation screen is meant to open with captions already in place. Doing
 * this on load would mean a vision read and a caption write per creative while
 * somebody watches a spinner, so it happens as QC passes instead — by the time
 * the team opens the tab the work is done.
 */
export async function writeCaptionFor(uploadId: string, baseUrl: string, cookie: string): Promise<boolean> {
  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("creative_uploads")
    .select("id, client_id, file_url, thumbnail_url, media_type, content_type, caption, caption_status, festival_id")
    .eq("id", uploadId)
    .maybeSingle();

  if (!row) return false;
  // A Story carries no caption on either platform, and a caption the designer
  // typed is theirs — neither gets overwritten.
  if (row.festival_id || row.content_type === "story" || row.content_type === "thumbnail") return false;
  if (String(row.caption || "").trim()) return false;
  if (row.caption_status === "done") return false;

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

    const res = await fetch(`${baseUrl}/api/social-publisher/generate-caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        clientId: row.client_id,
        platform: "instagram",
        contentType: row.content_type || "post",
        mediaUrl: row.file_url,
        mediaIsVideo: row.media_type === "video",
        thumbnailUrl: row.thumbnail_url || undefined,
        visionDescription: reading.description,
        onCreativeText: reading.onCreativeText,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.caption) {
      // A missing address is a fixable gap in the brand record, not a failure of
      // this creative — it is recorded distinctly so the screen can say which
      // client needs one instead of showing an unexplained empty box.
      if (data.code === "missing_contact") {
        await admin.from("creative_uploads").update({ caption_status: "no_contact" }).eq("id", uploadId);
        console.warn(`caption for upload ${uploadId} skipped: ${data.error}`);
        return false;
      }
      throw new Error(data.error || "no caption returned");
    }

    await admin
      .from("creative_uploads")
      .update({ caption: data.caption, caption_status: "done" })
      .eq("id", uploadId);
    return true;
  } catch (err: unknown) {
    // Not fatal: the Automation row simply shows an empty caption box the team
    // can fill or retry, which is where they were before this existed.
    await admin.from("creative_uploads").update({ caption_status: "failed" }).eq("id", uploadId);
    console.error(`caption for upload ${uploadId} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}
