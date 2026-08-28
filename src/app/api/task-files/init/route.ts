import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDriveAccessToken, ensureTaskFilesFolder } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

const MAX_BYTES = 500 * 1024 * 1024;

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!["founder", "employee"].includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * POST — open a resumable upload session. Body: { taskId, fileName, mime, sizeBytes }
 *
 * The portal never carries the bytes. A 500MB body buffered by a Next route
 * would gamble the container's memory, so the server does only the part that
 * needs its credentials — opening the session — and hands the browser a
 * capability URL to PUT the file to directly.
 */
export async function POST(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { taskId, fileName, mime, sizeBytes } = await request.json().catch(() => ({}));
  if (!taskId || !fileName) return NextResponse.json({ error: "taskId and fileName are required" }, { status: 400 });

  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "sizeBytes is required" }, { status: 400 });
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${(size / 1024 / 1024).toFixed(0)}MB — the limit is 500MB.` }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: task } = await admin.from("tasks").select("id, client_id, clients(name)").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "That task no longer exists." }, { status: 404 });

  const token = await getDriveAccessToken();
  if (!token) {
    return NextResponse.json({ error: "Google Drive isn't connected — connect it under Integrations first." }, { status: 400 });
  }

  const clientName = (task.clients as { name?: string } | null)?.name || null;
  const folderId = await ensureTaskFilesFolder(clientName);
  if (!folderId) return NextResponse.json({ error: "Could not open the Drive folder for this client." }, { status: 502 });

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      // Told up front so Drive can refuse an oversized upload before a byte moves.
      "X-Upload-Content-Type": mime || "application/octet-stream",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });

  const sessionUrl = res.headers.get("location");
  if (!res.ok || !sessionUrl) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Google refused to open the upload (${res.status}). ${detail.slice(0, 200)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, sessionUrl });
}
