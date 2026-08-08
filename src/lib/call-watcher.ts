import { createServiceRoleClient } from "@/lib/supabase/server";
import { listCallRecordings, isDriveConnected } from "@/lib/google-drive";
import { processCall } from "@/lib/call-notes";

/**
 * Picks up call recordings that phones have synced into Google Drive.
 *
 * Each person has their own folder, so who owns a recording — and therefore who
 * approves the tasks from it — is settled by where the file landed rather than
 * inferred from its contents. The founder's folder is separate from staff
 * folders for exactly this reason.
 *
 * The audio stays in Drive throughout. It is read through the Drive API when
 * transcribing and never copied into Supabase, which has no room for hours of
 * call audio.
 */

/** Files younger than this are skipped — a sync may still be writing them. */
const SETTLE_MS = 2 * 60 * 1000;
/** Per sweep, per folder. Keeps one busy day from running for an hour. */
const MAX_PER_FOLDER = 5;

export async function sweepCallFolders(): Promise<{
  scanned: number;
  processed: number;
  failed: number;
  notes: string[];
}> {
  const notes: string[] = [];

  if (!process.env.OPENAI_API_KEY) {
    return { scanned: 0, processed: 0, failed: 0, notes: ["OPENAI_API_KEY is not set — nothing can be transcribed."] };
  }
  if (!(await isDriveConnected())) {
    return { scanned: 0, processed: 0, failed: 0, notes: ["Google Drive is not connected."] };
  }

  const admin = createServiceRoleClient();
  const { data: folders } = await admin
    .from("call_watch_folders")
    .select("id, folder_id, folder_name, owner_id")
    .eq("active", true);

  if (!folders || folders.length === 0) {
    return { scanned: 0, processed: 0, failed: 0, notes: ["No folders are being watched yet."] };
  }

  let scanned = 0;
  let processed = 0;
  let failed = 0;

  for (const folder of folders) {
    let files;
    try {
      files = await listCallRecordings(folder.folder_id);
    } catch (err: unknown) {
      notes.push(`${folder.folder_name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    scanned += files.length;

    // Oldest first, so a backlog is worked through in the order it happened.
    const fresh = files
      .filter((f) => Date.now() - new Date(f.createdTime).getTime() > SETTLE_MS)
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));

    let doneHere = 0;
    for (const file of fresh) {
      if (doneHere >= MAX_PER_FOLDER) break;

      // The unique index on drive_file_id is the real guard; this just avoids
      // the round trip for files we already know about.
      const { data: seen } = await admin
        .from("call_recordings")
        .select("id")
        .eq("drive_file_id", file.id)
        .maybeSingle();
      if (seen) continue;

      const { data: row, error } = await admin
        .from("call_recordings")
        .insert({
          uploaded_by: folder.owner_id,
          title: file.name.replace(/\.[a-z0-9]+$/i, ""),
          // Kept for reference only — transcription reads via the Drive API,
          // because a Drive link does not serve raw bytes for media.
          audio_url: `https://drive.google.com/file/d/${file.id}/view`,
          drive_file_id: file.id,
          file_name: file.name,
          size_mb: file.sizeBytes ? Number((file.sizeBytes / 1024 / 1024).toFixed(1)) : null,
          status: "uploaded",
        })
        .select("id")
        .single();

      if (error || !row) {
        // A duplicate here means another sweep claimed it first — not a failure.
        if (!String(error?.message || "").includes("duplicate")) {
          failed++;
          notes.push(`${file.name}: ${error?.message || "could not be recorded"}`);
        }
        continue;
      }

      const result = await processCall(row.id);
      doneHere++;
      if (result.ok) {
        processed++;
        notes.push(`${file.name} → ${result.created} task${result.created === 1 ? "" : "s"} for ${folder.folder_name}`);
      } else {
        failed++;
        notes.push(`${file.name}: ${result.message}`);
      }
    }

    await admin
      .from("call_watch_folders")
      .update({ last_scanned_at: new Date().toISOString() })
      .eq("id", folder.id);
  }

  return { scanned, processed, failed, notes };
}
