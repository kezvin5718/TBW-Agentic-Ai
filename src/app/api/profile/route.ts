import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FIELDS = "id, name, role, designation, phone, about, avatar_url, brand_name, approved, created_at";
const MAX_PHOTO = 5 * 1024 * 1024;

// GET — the signed-in person's own profile.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from("profiles").select(FIELDS).eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, profile: { ...(data || {}), email: user.email } });
}

// PATCH — edit your own details. Role, approval and permissions are deliberately
// NOT editable here; those stay with the founder in /api/team.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "designation", "phone", "about"] as const) {
    if (body[key] !== undefined) patch[key] = String(body[key]).trim().slice(0, key === "about" ? 500 : 120) || null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from("profiles").update(patch).eq("id", user.id).select(FIELDS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the auth metadata copy of the name in step — the sidebar reads it.
  if (patch.name) await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, name: patch.name } });

  return NextResponse.json({ success: true, profile: { ...data, email: user.email } });
}

// POST — upload your profile photo (multipart form, field "file").
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No photo selected" }, { status: 400 });
  if (!(file.type || "").startsWith("image/")) {
    return NextResponse.json({ error: "That's not an image — use a JPG or PNG." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO) {
    return NextResponse.json({ error: "Photo is over 5 MB — pick a smaller one." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
  // Fixed folder per user so an old photo is replaced, not piled up.
  const path = `${user.id}/photo-${Date.now()}.${ext}`;

  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const publicUrl = admin.storage.from("avatars").getPublicUrl(path).data.publicUrl;

  // Clear out the previous photo so the bucket doesn't collect orphans.
  const { data: prev } = await admin.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
  const oldPath = String(prev?.avatar_url || "").split("/avatars/")[1];
  if (oldPath && oldPath !== path) await admin.storage.from("avatars").remove([oldPath]).catch(() => {});

  const { error } = await admin.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, avatar_url: publicUrl });
}

// DELETE — remove your photo and fall back to initials.
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data: prev } = await admin.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
  const path = String(prev?.avatar_url || "").split("/avatars/")[1];
  if (path) await admin.storage.from("avatars").remove([path]).catch(() => {});
  await admin.from("profiles").update({ avatar_url: null }).eq("id", user.id);
  return NextResponse.json({ success: true });
}
