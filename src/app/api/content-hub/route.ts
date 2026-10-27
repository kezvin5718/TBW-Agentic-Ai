import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { generateThumbnailFor } from "@/lib/video-thumbnail";
import { storeContentHubUpload, deleteDriveFileByUrl } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — list recent uploads (newest first), optionally filtered by ?clientId=
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = new URL(request.url).searchParams.get("clientId");
  let query = supabase
    .from("creative_uploads")
    .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A carousel is one row with its slides beside it. The slides ride along on
  // the rows the caller can already see — one cheap read, scoped to those ids
  // — so the hub can badge "N slides" and show them without a second trip.
  // If the read fails the list still loads; the badge falls back to the name.
  const rows = (data || []) as Array<Record<string, unknown>>;
  const carouselIds = rows.filter((r) => r.content_type === "carousel").map((r) => r.id as string);
  if (carouselIds.length > 0) {
    const { data: slides } = await createServiceRoleClient()
      .from("carousel_slides")
      .select("upload_id, slide_no, file_url, file_name")
      .in("upload_id", carouselIds)
      .order("slide_no", { ascending: true });
    const byUpload = new Map<string, Array<{ slide_no: number; file_url: string; file_name: string | null }>>();
    for (const s of slides || []) {
      const list = byUpload.get(s.upload_id as string) || [];
      list.push({ slide_no: s.slide_no as number, file_url: s.file_url as string, file_name: (s.file_name as string | null) ?? null });
      byUpload.set(s.upload_id as string, list);
    }
    for (const r of rows) if (r.content_type === "carousel") r.slides = byUpload.get(r.id as string) || [];
  }
  return NextResponse.json({ success: true, uploads: rows });
}

// POST (multipart) — upload a creative file for a client, store it, record it.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden — designers/founders only" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const thumbFile = form.get("thumbnail") as File | null;
  const clientId = form.get("clientId") as string | null;
  const contentType = (form.get("contentType") as string | null) || "post";
  const caption = (form.get("caption") as string | null) || "";
  // Present only for a festival story. It makes the upload self-scheduling:
  // QC checks it against this festival, and on a pass it is queued at the
  // festival's own time without anyone visiting the composer.
  const festivalId = (form.get("festivalId") as string | null) || null;
  // Files chosen together share a batch, and a batch is approved or rejected as
  // one — a set is corrected and resubmitted together, not file by file.
  const batchId = (form.get("batchId") as string | null) || null;

  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "Please select a client" }, { status: 400 });
  if (!["post", "reel", "story", "thumbnail"].includes(contentType)) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  }
  if (festivalId && contentType !== "story") {
    return NextResponse.json({ error: "A festival creative can only be uploaded as a story." }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  const mediaType = mime.startsWith("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name) ? "video" : "image";
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}-${safeName}`;

  const admin = createServiceRoleClient();

  // Look up client name + current month for the Drive folder path.
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();
  const clientName = client?.name || undefined;
  const monthLabel = new Date().toISOString().slice(0, 7);

  // Store to Google Drive ("TBW Content Hub / {client} / {month}") when connected,
  // else Supabase fallback.
  const publicUrl = await storeContentHubUpload(buffer, fileName, mime, clientName, monthLabel);
  if (!publicUrl) {
    return NextResponse.json({ error: "Upload failed — check Google Drive / storage connection." }, { status: 500 });
  }

  // Optional paired thumbnail (video editors upload numbered videos + thumbs).
  let thumbnailUrl: string | null = null;
  let thumbnailName: string | null = null;
  if (thumbFile) {
    const tBuf = Buffer.from(await thumbFile.arrayBuffer());
    const tSafe = (thumbFile.name || "thumb").replace(/[^a-zA-Z0-9._-]/g, "_");
    thumbnailUrl = await storeContentHubUpload(
      tBuf,
      `${Date.now()}-thumb-${tSafe}`,
      thumbFile.type || "image/jpeg",
      clientName,
      monthLabel
    );
    thumbnailName = thumbFile.name || null;
  }

  const { data: row, error } = await admin
    .from("creative_uploads")
    .insert({
      client_id: clientId,
      uploaded_by: user.id,
      file_url: publicUrl,
      file_name: file.name,
      file_size: buffer.length,
      media_type: mediaType,
      content_type: contentType,
      // A Story carries no caption on either platform — the creative is the
      // whole message, which is why the festival section never asks for one.
      caption: festivalId ? "" : caption,
      thumbnail_url: thumbnailUrl,
      thumbnail_name: thumbnailName,
      // A cover that came with the video is the designer's and is final. A
      // video without one waits for its automatic frame.
      thumbnail_source: thumbnailUrl ? "designer" : null,
      thumbnail_status: mediaType === "video" ? (thumbnailUrl ? "completed" : "pending") : null,
      festival_id: festivalId,
      batch_id: batchId,
      status: "uploaded",
    })
    .select("*, clients(name), profiles:uploaded_by(name, avatar_url, designation)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Not awaited: the response goes now and the Node server carries on making
  // the frame. generateThumbnailFor never rejects; the catch is belt and braces,
  // because an unhandled rejection here would take the whole server down.
  if (mediaType === "video" && !thumbnailUrl && row?.id) {
    void generateThumbnailFor(row.id as string).catch((err: unknown) => console.error(`video thumbnail ${row.id}: could not start —`, err));
  }
  return NextResponse.json({ success: true, upload: row });
}

// DELETE — remove a mistaken upload (uploader can delete their own; founder any).
// Only items still in "uploaded" state; best-effort removes the stored file too.
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const targetIds: string[] = Array.isArray(body.ids) && body.ids.length ? body.ids : body.id ? [body.id] : [];
  if (targetIds.length === 0) return NextResponse.json({ error: "id or ids required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: rows } = await admin
    .from("creative_uploads")
    .select("id, uploaded_by, status, file_url, thumbnail_url")
    .in("id", targetIds);
  if (!rows || rows.length === 0) return NextResponse.json({ error: "Upload(s) not found" }, { status: 404 });

  // Rejected rows are deletable too — a rejected creative is not scheduled,
  // which is the only thing this guard protects. Without it, the founder's
  // "I deleted it but Risk still shows it" ghosts were literally undeletable.
  const deletable = rows.filter(
    (r) => (r.status === "uploaded" || r.status === "rejected") && (role === "founder" || r.uploaded_by === user.id)
  );
  const skipped = rows.length - deletable.length;
  if (deletable.length === 0) {
    return NextResponse.json(
      { error: "Nothing could be deleted — items are already scheduled, or belong to someone else." },
      { status: 403 }
    );
  }

  const { error } = await admin.from("creative_uploads").delete().in("id", deletable.map((r) => r.id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort file cleanup (records are already gone either way).
  for (const r of deletable) {
    for (const url of [r.file_url as string, r.thumbnail_url as string | null]) {
      if (!url) continue;
      if (url.includes("googleusercontent.com") || url.includes("drive.google.com")) {
        await deleteDriveFileByUrl(url);
      } else if (url.includes("/studio-outputs/")) {
        const path = url.split("/studio-outputs/")[1]?.split("?")[0];
        if (path) await admin.storage.from("studio-outputs").remove([path]).catch(() => {});
      }
    }
  }

  return NextResponse.json({ success: true, deleted: deletable.length, skipped });
}
