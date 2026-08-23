import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ensureCallFolder, isDriveConnected, CALL_ROOT_FOLDER } from "@/lib/google-drive";
import { sweepCallFolders } from "@/lib/call-watcher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Founder-only, same as /api/calls — a watched folder is a way into the calls.
// The per-owner branches below are left standing so staff can be let back in
// by loosening this one line.
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (role !== "founder") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user, isFounder: role === "founder" };
}

/** GET — the watched folders. Yours, or everyone's if you're the founder. */
export async function GET() {
  const guard = await me();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  let q = admin
    .from("call_watch_folders")
    .select("*, profiles:owner_id(name, avatar_url, designation)")
    .order("created_at", { ascending: true });
  if (!guard.isFounder) q = q.eq("owner_id", guard.user!.id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    folders: (data || []).map((f) => ({
      ...f,
      folder_url: `https://drive.google.com/drive/folders/${f.folder_id}`,
    })),
    driveConnected: await isDriveConnected(),
    rootFolderName: CALL_ROOT_FOLDER,
  });
}

/**
 * POST — create (or find) my recordings folder in Drive, or sweep now.
 *
 * Each person claims their own folder, so a recording's owner is decided by
 * where it landed rather than guessed from the audio. The founder's folder is
 * separate from staff folders, which is what keeps "only I approve my calls"
 * true without anyone having to remember it.
 */
export async function POST(request: NextRequest) {
  const guard = await me();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));

  if (body.action === "sweep") {
    const result = await sweepCallFolders();
    return NextResponse.json({ success: true, ...result });
  }

  if (!(await isDriveConnected())) {
    return NextResponse.json(
      { error: "Google Drive isn't connected — connect it under Integrations first, then come back." },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  const { data: profile } = await admin.from("profiles").select("name").eq("id", guard.user!.id).maybeSingle();

  // Folder names carry the role so the founder's is unmistakable in Drive.
  const personName = (profile?.name || guard.user!.email?.split("@")[0] || "Staff").trim();
  const label = guard.isFounder ? `${personName} (Founder)` : personName;

  let created;
  try {
    created = await ensureCallFolder(label);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create the folder" }, { status: 500 });
  }

  const { error } = await admin
    .from("call_watch_folders")
    .upsert(
      { folder_id: created.folderId, folder_name: label, owner_id: guard.user!.id, active: true },
      { onConflict: "folder_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    folderName: label,
    folderId: created.folderId,
    folderUrl: created.folderUrl,
    rootUrl: created.rootUrl,
    rootFolderName: CALL_ROOT_FOLDER,
    message: `Your folder is "${CALL_ROOT_FOLDER} / ${label}" in Google Drive. Point your phone's recording backup at it.`,
  });
}

/** DELETE — stop watching a folder. The Drive folder and its files remain. */
export async function DELETE(request: NextRequest) {
  const guard = await me();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("call_watch_folders").select("owner_id").eq("id", body.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!guard.isFounder && row.owner_id !== guard.user!.id) {
    return NextResponse.json({ error: "That folder belongs to someone else." }, { status: 403 });
  }

  const { error } = await admin.from("call_watch_folders").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
