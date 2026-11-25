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
export type { CaptionOutcome } from "@/lib/caption-worker";

/**
 * Write one creative's caption now — the Automation screen's buttons.
 *
 * Captions normally write themselves in the background as soon as a creative
 * is uploaded (see caption-worker). This is the same job, asked for by a
 * person: `force` is what makes Rewrite mean "write me another one", even over
 * a caption that was already written or typed by hand.
 */
export async function captionForUpload(
  uploadId: string,
  opts: { force?: boolean; brief?: string } = {}
) {
  const { generateCaption } = await import("@/lib/caption-worker");
  return generateCaption(uploadId, { ...opts, by: "person" });
}

/** Returns true when a caption was written, for callers that only count. */
export async function writeCaptionFor(uploadId: string): Promise<boolean> {
  return (await captionForUpload(uploadId)).ok;
}
