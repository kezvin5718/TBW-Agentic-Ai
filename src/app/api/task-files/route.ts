import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { deleteDriveFileById } from "@/lib/google-drive";

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
 * DELETE — remove an attachment. Body: { id }
 *
 * The Drive file goes with the row. An attachment nothing references any more
 * would otherwise squat in Drive for good, counting against the same quota the
 * creatives need.
 */
export async function DELETE(request: NextRequest) {
  const guard = await requireStaff();
  if (guard.error) return guard.error;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: row } = await admin.from("task_attachments").select("id, drive_file_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "That attachment is already gone." }, { status: 404 });

  const { error } = await admin.from("task_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Best effort: the row is what the board reads, so a Drive hiccup here must
  // not leave the attachment visible and undeletable.
  if (row.drive_file_id) await deleteDriveFileById(row.drive_file_id as string);

  return NextResponse.json({ success: true });
}
