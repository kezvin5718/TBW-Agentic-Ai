import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST (multipart: file) — upload media or thumbnail for social posting.
 * Stored on Supabase Storage (NOT Drive) because Zapier/Meta must be able to
 * fetch the URL directly — Drive links are unreliable for that, especially video.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.user_metadata?.role as string) || "client";
    if (!user || !["founder", "employee"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sizeMb = buffer.length / 1024 / 1024;
    const safeName = (file.name || "media").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `social/${Date.now()}-${safeName}`;
    const contentType = file.type || "application/octet-stream";

    const admin = createServiceRoleClient();
    const { error: upErr } = await admin.storage
      .from("studio-outputs")
      .upload(path, buffer, { contentType, upsert: true });

    if (upErr) {
      console.error("Social upload storage error:", upErr.message, `(file: ${safeName}, ${sizeMb.toFixed(1)}MB, ${contentType})`);
      const hint = /exceeded|too large|payload|maximum/i.test(upErr.message)
        ? ` — the file is ${sizeMb.toFixed(1)}MB; your Supabase project's max upload size is likely smaller (default 50MB, configurable in Supabase → Storage → Settings).`
        : "";
      return NextResponse.json({ error: `Storage upload failed: ${upErr.message}${hint}` }, { status: 500 });
    }

    const { data: pub } = admin.storage.from("studio-outputs").getPublicUrl(path);
    const url = pub?.publicUrl;
    if (!url) return NextResponse.json({ error: "Upload succeeded but no public URL was returned." }, { status: 500 });

    const isVideo = contentType.startsWith("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name);
    return NextResponse.json({ success: true, url, mediaType: isVideo ? "video" : "image", fileName: file.name, sizeMb: Number(sizeMb.toFixed(1)) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Social upload route crashed:", msg);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}
