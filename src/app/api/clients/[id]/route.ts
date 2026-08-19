import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Removing a client is two separate acts, deliberately.
 *
 * Archiving hides the client from every picker and list but keeps everything —
 * posts, plans, uploads, the brand brain. It is reversible and is what "we
 * stopped working with them" actually means.
 *
 * Permanent deletion cascades into a dozen tables and destroys the record of
 * everything ever published for that brand. It is founder-only, only possible
 * once the client is already archived, and requires typing the name back.
 */

/** Tables whose rows die with the client, and the ones merely cut loose. */
const CASCADES: Array<{ table: string; label: string }> = [
  { table: "social_posts", label: "published & scheduled posts" },
  { table: "creative_uploads", label: "Content Hub uploads" },
  { table: "monthly_plans", label: "monthly plans" },
  { table: "campaigns", label: "campaigns" },
  { table: "brand_brain", label: "brand brain" },
  { table: "weekly_reports", label: "weekly reports" },
  { table: "approvals", label: "approvals" },
  { table: "scheduled_posts", label: "scheduled posts" },
  { table: "whatsapp_messages", label: "WhatsApp messages" },
  { table: "client_credentials", label: "stored credentials" },
];
const ORPHANS: Array<{ table: string; label: string }> = [
  { table: "tasks", label: "tasks" },
  { table: "wa_inbox", label: "WhatsApp inbox messages" },
  { table: "wa_task_drafts", label: "WhatsApp task drafts" },
];

/**
 * Counts what hangs off a client. A count that fails must never read as zero —
 * "nothing attached" is what allows a one-click delete, so an unreadable table
 * has to be an error, not an empty result.
 */
async function tally(clientId: string) {
  const admin = createServiceRoleClient();
  const count = async (table: string) => {
    const { count: n, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    return n || 0;
  };
  const destroyed: Record<string, number> = {};
  const detached: Record<string, number> = {};
  await Promise.all([
    ...CASCADES.map(async (t) => { const n = await count(t.table); if (n > 0) destroyed[t.label] = n; }),
    ...ORPHANS.map(async (t) => { const n = await count(t.table); if (n > 0) detached[t.label] = n; }),
  ]);
  return { destroyed, detached };
}

async function requireRole(allowed: string[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (!allowed.includes(role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/** GET — what archiving/deleting this client would affect. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(["founder", "employee"]);
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    const { destroyed, detached } = await tally(id);
    return NextResponse.json({ success: true, client, destroyed, detached });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read what is attached to this client." },
      { status: 500 }
    );
  }
}

/** PATCH { action: "archive" | "restore" | "rename" } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(["founder", "employee"]);
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (!["archive", "restore", "rename", "deliverables"].includes(action)) {
    return NextResponse.json({ error: "action must be 'archive', 'restore', 'rename', or 'deliverables'" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: client } = await admin.from("clients").select("id, name").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (action === "deliverables") {
    // The contract number is the commercial agreement — only the founder moves it.
    const role = (guard.user?.user_metadata?.role as string) || "";
    if (role !== "founder") {
      return NextResponse.json({ error: "Only the founder can change a client's contracted deliverables." }, { status: 403 });
    }
    const count = Number(body.count);
    if (!Number.isFinite(count) || count < 0 || count > 200) {
      return NextResponse.json({ error: "Give a sensible monthly deliverables number (0–200)." }, { status: 400 });
    }
    const { error } = await admin.from("clients").update({ deliverables_per_month: count }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, message: `${client.name}'s contract is now ${count} deliverables/month.` });
  }

  if (action === "rename") {
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Give the client a name." }, { status: 400 });
    const { error } = await admin.from("clients").update({ name }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, message: `Renamed to ${name}.`, name });
  }

  const { error } = await admin
    .from("clients")
    .update(
      action === "archive"
        ? { archived_at: new Date().toISOString(), archived_by: guard.user!.id }
        : { archived_at: null, archived_by: null }
    )
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    message:
      action === "archive"
        ? `${client.name} archived — hidden everywhere, nothing deleted. You can restore it any time.`
        : `${client.name} restored.`,
  });
}

/**
 * DELETE { confirmName } — permanent, founder-only, archived-only.
 * The name must be typed back exactly; there is no undo after this.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRole(["founder"]);
  if (guard.error) {
    // Be explicit: an employee archiving is fine, deleting forever is not.
    return NextResponse.json(
      { error: "Only the founder can permanently delete a client. You can archive it instead — that hides it without losing anything." },
      { status: 403 }
    );
  }

  const admin = createServiceRoleClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Record what is about to be destroyed before it stops being countable. If we
  // can't establish that, refuse — never fall through to "looks empty".
  let destroyed: Record<string, number>;
  let detached: Record<string, number>;
  try {
    ({ destroyed, detached } = await tally(id));
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Could not check what is attached to ${client.name}, so nothing was deleted. ${err instanceof Error ? err.message : ""}`.trim() },
      { status: 500 }
    );
  }
  const isEmpty = Object.keys(destroyed).length === 0 && Object.keys(detached).length === 0;

  // An empty client is a typo or a double entry — there is no history to lose,
  // so it goes in one click. The archive-first and type-the-name ceremony is
  // there to protect real work, and applies only when there is some.
  if (!isEmpty) {
    if (!client.archived_at) {
      return NextResponse.json(
        { error: `${client.name} has work attached to it. Archive it first — if that turns out to be a mistake it is recoverable, and this is not.` },
        { status: 409 }
      );
    }
    const body = await request.json().catch(() => ({}));
    const typed = String(body.confirmName || "").trim();
    if (typed.toLowerCase() !== client.name.trim().toLowerCase()) {
      return NextResponse.json(
        { error: `Type the client's name exactly — "${client.name}" — to confirm permanent deletion.` },
        { status: 400 }
      );
    }
  }

  const { error } = await admin.from("clients").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.warn(
    `[clients] PERMANENT DELETE "${client.name}" (${id}) by ${guard.user!.id} —`,
    JSON.stringify({ destroyed, detached })
  );

  return NextResponse.json({
    success: true,
    message: `${client.name} deleted permanently.`,
    destroyed,
    detached,
  });
}
