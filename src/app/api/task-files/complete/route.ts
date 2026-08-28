import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDriveFileMeta, shareFileWithLink, driveViewUrl } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * POST — record a file the browser has finished uploading.
 * Body: { taskId, driveFileId, fileName, mime, sizeBytes }
 *
 * The id comes from the browser, so nothing is trusted: Drive is asked whether
 * the file really exists before a row is written for it.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { taskId, driveFileId, fileName, mime, sizeBytes } = await request.json().catch(() => ({}));
  if (!taskId || !driveFileId) return NextResponse.json({ error: "taskId and driveFileId are required" }, { status: 400 });

  const meta = await getDriveFileMeta(driveFileId);
  if (!meta) return NextResponse.json({ error: "That upload could not be found in Drive." }, { status: 404 });

  // The team opens these from the portal; without this they would meet a
  // Google sign-in wall instead of the file.
  await shareFileWithLink(driveFileId);

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("task_attachments")
    .insert({
      task_id: taskId,
      file_name: fileName || meta.name,
      mime: mime || meta.mimeType,
      size_bytes: Number(sizeBytes) || meta.size,
      drive_file_id: driveFileId,
      url: driveViewUrl(driveFileId, mime || meta.mimeType),
      uploaded_by: guard.user!.id,
    })
    .select("id, task_id, file_name, mime, size_bytes, url, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, attachment: data });
}
