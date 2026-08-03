import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadToSupabaseStorageDirect } from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST (multipart: file) — upload media or thumbnail for social posting.
 * Stored on Supabase Storage (NOT Drive) because Zapier/Meta must be able to
 * fetch the URL directly — Drive links are unreliable for that, especially video.
 */
export async function POST(request: NextRequest) {
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
  const safeName = (file.name || "media").replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `social/${Date.now()}-${safeName}`;
  const url = await uploadToSupabaseStorageDirect(fileName, buffer, file.type || "application/octet-stream");
  if (!url) return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });

  const isVideo = (file.type || "").startsWith("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name);
  return NextResponse.json({ success: true, url, mediaType: isVideo ? "video" : "image", fileName: file.name });
}
