import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { storeContentHubUpload } from "@/lib/google-drive";

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
    .select("*, clients(name), profiles:uploaded_by(name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, uploads: data || [] });
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
  const clientId = form.get("clientId") as string | null;
  const contentType = (form.get("contentType") as string | null) || "post";
  const caption = (form.get("caption") as string | null) || "";

  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "Please select a client" }, { status: 400 });
  if (!["post", "reel", "story"].includes(contentType)) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
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
      caption,
      status: "uploaded",
    })
    .select("*, clients(name), profiles:uploaded_by(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, upload: row });
}
