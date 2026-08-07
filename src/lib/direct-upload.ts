"use client";

import { createClient } from "@/lib/supabase/client";
import { fetchWithAuthRetry } from "@/lib/api-fetch";

export type DirectUpload = {
  url: string;
  fileName: string;
  mediaType: "video" | "image";
  sizeMb: number;
};

/**
 * Sends a file straight from the browser to Supabase Storage.
 *
 * The server only issues a signed ticket (a few hundred bytes of JSON); the
 * file itself never passes through it. That is what keeps a 200MB reel from
 * exhausting the container's memory, and it also means the upload is one hop
 * instead of two.
 */
export async function uploadDirect(
  file: File,
  destination: "social" = "social",
  onProgress?: (percent: number) => void
): Promise<DirectUpload> {
  const ticketRes = await fetchWithAuthRetry("/api/storage/signed-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination, fileName: file.name }),
  });
  const ticket = await ticketRes.json();
  if (!ticketRes.ok) throw new Error(ticket.error || "Could not start the upload.");

  const supabase = createClient();
  const contentType = file.type || "application/octet-stream";

  // uploadToSignedUrl reports no progress, so drive the bar from XHR when a
  // caller wants one and fall back to the SDK otherwise.
  if (onProgress) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", ticket.signedUrl || "", true);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        // 413 is Supabase's project-wide upload cap, not anything about this
        // file being wrong — say which knob to turn rather than the raw code.
        if (xhr.status === 413) {
          return reject(
            new Error(
              `This file is ${(file.size / 1024 / 1024).toFixed(0)}MB, above the Supabase project's upload limit. Raise it in Supabase → Storage → Settings, or compress the video.`
            )
          );
        }
        reject(new Error(`Upload failed (${xhr.status}). ${xhr.responseText?.slice(0, 200) || ""}`.trim()));
      };
      xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
      xhr.send(file);
    });
  } else {
    const { error } = await supabase.storage
      .from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType });
    if (error) throw new Error(error.message);
  }

  if (!ticket.publicUrl) throw new Error("Upload finished but no public URL came back.");

  const isVideo = contentType.startsWith("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name);
  return {
    url: ticket.publicUrl,
    fileName: file.name,
    mediaType: isVideo ? "video" : "image",
    sizeMb: Number((file.size / 1024 / 1024).toFixed(1)),
  };
}
