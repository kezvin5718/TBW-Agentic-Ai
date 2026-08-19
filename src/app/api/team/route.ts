import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET — list all users (founder only).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || role !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, role, brand_name, approved, permissions, can_delete_tasks, created_at, avatar_url, designation, phone, about")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach the login email so the founder has everyone's contact in one place.
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((authList?.users || []).map((u) => [u.id, u.email]));
  const users = (data || []).map((u) => ({ ...u, email: emailById.get(u.id) || null }));

  return NextResponse.json({ success: true, users });
}

// PATCH — approve / reject / set role. Body: { userId, action, role? }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myRole = (user?.user_metadata?.role as string) || "client";
  if (!user || myRole !== "founder") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, action, role, permissions, allowed } = await request.json();
  if (!userId || !action) return NextResponse.json({ error: "userId and action required" }, { status: 400 });
  if (userId === user.id && action === "revoke") {
    return NextResponse.json({ error: "You can't revoke your own account." }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Reject = fully delete the account (auth user + profile via cascade), so the
  // pending list clears and the person can register again later if needed.
  if (action === "reject") {
    if (userId === user.id) return NextResponse.json({ error: "You can't reject your own account." }, { status: 400 });
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return NextResponse.json({ error: `Could not remove account: ${delErr.message}` }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const patch: Record<string, unknown> = {};
  if (action === "approve") {
    patch.approved = true;
    if (role && ["founder", "employee", "client"].includes(role)) patch.role = role;
  } else if (action === "revoke") {
    patch.approved = false;
  } else if (action === "set_role") {
    if (!["founder", "employee", "client"].includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    patch.role = role;
  } else if (action === "set_permissions") {
    // null = full default access; array of section keys = ONLY those sections.
    if (permissions !== null && !Array.isArray(permissions)) {
      return NextResponse.json({ error: "permissions must be an array of section keys or null" }, { status: 400 });
    }
    patch.permissions = permissions;
  } else if (action === "set_task_delete") {
    // Deleting a task is destructive and unrecoverable, so it is granted per
    // person rather than to the employee role as a whole.
    patch.can_delete_tasks = !!allowed;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
