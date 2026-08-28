/**
 * The browser half of a task-file upload.
 *
 * The bytes go straight from the person's machine to Google, in 8MB chunks,
 * over a session URL the server opened. Nothing here touches the portal's own
 * server — a 500MB file passing through a Next route would gamble the
 * container's memory, and this is the whole reason that route does not exist.
 */

export interface UploadedFile {
  driveFileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/** Big enough that a large file is not a thousand requests, small enough to retry cheaply. */
const CHUNK = 8 * 1024 * 1024;

/**
 * PUT one file to its resumable session, reporting progress as it goes.
 *
 * Google answers 308 for "keep going" and 200/201 with the file's JSON on the
 * last chunk — anything else is a failure worth naming.
 */
export async function uploadToSession(
  sessionUrl: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const total = file.size;
  let sent = 0;

  while (sent < total) {
    const end = Math.min(sent + CHUNK, total);
    const chunk = file.slice(sent, end);
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${sent}-${end - 1}/${total}` },
      body: chunk,
    });

    if (res.status === 308) {
      // Google reports how much it actually kept; trust that over our own count.
      const range = res.headers.get("range");
      const got = range ? Number(range.split("-")[1]) + 1 : end;
      sent = Number.isFinite(got) ? got : end;
      onProgress?.(sent / total);
      continue;
    }

    if (res.ok) {
      onProgress?.(1);
      const data = await res.json().catch(() => null);
      const id = (data as { id?: string } | null)?.id;
      if (!id) throw new Error("Drive finished the upload but returned no file id.");
      return id;
    }

    const detail = await res.text().catch(() => "");
    throw new Error(`Drive rejected the upload (${res.status}). ${detail.slice(0, 160)}`);
  }

  throw new Error("The upload ended without Drive confirming the file.");
}

/**
 * Open a session, send the file, and record it against the task.
 *
 * Sequential by design: two 500MB uploads at once is how a hotel wifi
 * connection loses both.
 */
export async function uploadTaskFile(
  taskId: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<UploadedFile> {
  const initRes = await fetch("/api/task-files/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, fileName: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size }),
  });
  const init = await initRes.json();
  if (!initRes.ok || !init.sessionUrl) throw new Error(init.error || "Could not start the upload.");

  const driveFileId = await uploadToSession(init.sessionUrl, file, onProgress);

  const doneRes = await fetch("/api/task-files/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, driveFileId, fileName: file.name, mime: file.type, sizeBytes: file.size }),
  });
  const done = await doneRes.json();
  if (!doneRes.ok) throw new Error(done.error || "The file uploaded but could not be recorded.");

  return { driveFileId, fileName: file.name, mime: file.type, sizeBytes: file.size };
}

/** "4.2 MB" — the size a person reads, not a byte count. */
export function humanSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
