import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The standing answer to "who makes what" at every festival.
 *
 * Master designers make the original creative for their master clients;
 * adaptation clients hang under a master client and get that design adapted
 * by a named designer; standalone clients get a fresh design of their own. The
 * map is drawn once and reused for every festival — Allot turns it into tasks.
 *
 * The founder's order: the map is confidential. Every verb, GET included,
 * answers only to the founder and to employees he has granted it by name.
 */

const KINDS = ["master", "adaptation", "standalone"] as const;
type Kind = (typeof KINDS)[number];
const DAY = 24 * 3600 * 1000;

const forbidden = () =>
  NextResponse.json({ error: "Only the founder and people granted festival allotment can see this map." }, { status: 403 });

/**
 * Who may see and edit the map. Founders always; employees only by named
 * grant (profiles.can_manage_allotment) — the same shape as moving tasks.
 * Deciding which designer carries which brand at every festival decides
 * several people's weeks at once, so it stays a decision the founder hands out.
 */
async function mayManageAllotment(userId: string, role: string): Promise<boolean> {
  if (role === "founder") return true;
  if (role !== "employee") return false;
  const admin = createServiceRoleClient();
  const { data } = await admin.from("profiles").select("can_manage_allotment").eq("id", userId).maybeSingle();
  return !!data?.can_manage_allotment;
}

async function requireAllotment() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  // No session reads the same as no grant: nothing about the map leaks out,
  // not even that it exists.
  if (!user || !(await mayManageAllotment(user.id, role))) return { error: forbidden() };
  return { error: null, user };
}

interface NodeRow {
  id: string;
  kind: Kind;
  client_id: string;
  designer_member_id: string | null;
  master_client_id: string | null;
  sort: number | null;
  created_at: string;
}

type Admin = ReturnType<typeof createServiceRoleClient>;

/** A string id, or null for anything blank — "" from a select means "nobody". */
const idOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * An adaptation hangs from a master CLIENT, and that client has to be a master
 * on the map right now — adapting from a brand nobody makes an original for
 * would hand someone a task with nothing to start from.
 */
async function checkMaster(admin: Admin, masterClientId: string, ownClientId: string): Promise<string | null> {
  if (masterClientId === ownClientId) return "A client can't be adapted from itself.";
  const { data } = await admin.from("festival_allotment").select("kind").eq("client_id", masterClientId).maybeSingle();
  if (!data || data.kind !== "master") return "Adaptations must hang under a client that is a master on the map.";
  return null;
}

/** A designer the form named has to be someone Team & Access still knows. */
async function checkDesigner(admin: Admin, memberId: string): Promise<string | null> {
  const { data } = await admin.from("team_members").select("id").eq("id", memberId).maybeSingle();
  return data ? null : "That designer is no longer on the team.";
}

/** How many adaptations hang from this master client — the ones a kind change or delete would orphan. */
async function adaptationsUnder(admin: Admin, clientId: string): Promise<number> {
  const { count } = await admin
    .from("festival_allotment")
    .select("id", { count: "exact", head: true })
    .eq("kind", "adaptation")
    .eq("master_client_id", clientId);
  return count || 0;
}

/** GET — the whole map, with names joined, and the lists its pickers need. */
export async function GET() {
  const guard = await requireAllotment();
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  // festival_allotment points at clients twice (its own client and its master),
  // so an embed would be ambiguous — the names are joined here instead.
  const [{ data: nodes, error }, { data: clients }, { data: members }, { data: profs }] = await Promise.all([
    admin.from("festival_allotment")
      .select("id, kind, client_id, designer_member_id, master_client_id, sort, created_at")
      .order("sort", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    admin.from("clients").select("id, name").order("name"),
    admin.from("team_members").select("id, name, role_title, profile_id, away_until, active").order("name"),
    admin.from("profiles").select("id, avatar_url, designation"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientName = new Map((clients || []).map((c) => [c.id as string, c.name as string]));
  const byProfile = new Map((profs || []).map((p) => [p.id as string, p]));
  const allMembers = (members || []).map((m) => {
    const prof = m.profile_id ? byProfile.get(m.profile_id as string) : null;
    return {
      id: m.id as string,
      name: m.name as string,
      role_title: (m.role_title as string | null) || (prof?.designation as string | null) || null,
      away_until: (m.away_until as string | null) || null,
      avatar_url: (prof?.avatar_url as string | null) || null,
      active: !!m.active,
    };
  });
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  const joined = ((nodes || []) as NodeRow[]).map((n) => {
    // A deactivated designer still answers by name — the map says who it was
    // until someone picks who it is now.
    const designer = n.designer_member_id ? memberById.get(n.designer_member_id) : null;
    return {
      ...n,
      client_name: clientName.get(n.client_id) || "Unknown client",
      master_client_name: n.master_client_id ? clientName.get(n.master_client_id) || "Unknown client" : null,
      designer_name: designer?.name || null,
      designer_avatar_url: designer?.avatar_url || null,
    };
  });

  return NextResponse.json({
    success: true,
    nodes: joined,
    clients: clients || [],
    // The pickers offer the active team, exactly as the Festivals board does.
    team: allMembers.filter((m) => m.active),
    canManage: true,
  });
}

/**
 * POST — two things, told apart by `allot`:
 *   { kind, clientId, designerMemberId?, masterClientId? } adds a client to the map
 *   { allot: true, festivalId }                            turns the map into tasks
 */
export async function POST(request: NextRequest) {
  const guard = await requireAllotment();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  if (body?.allot === true) return allot(body.festivalId);

  const kind = body?.kind as Kind;
  const clientId = idOrNull(body?.clientId);
  const designerMemberId = idOrNull(body?.designerMemberId);
  const masterClientId = idOrNull(body?.masterClientId);

  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Pick Master, Adaptation or Standalone." }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "Pick a client." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "That client no longer exists." }, { status: 404 });

  if (kind === "adaptation") {
    if (!masterClientId) return NextResponse.json({ error: "An adaptation needs the master client it is adapted from." }, { status: 400 });
    const bad = await checkMaster(admin, masterClientId, clientId);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  } else if (masterClientId) {
    return NextResponse.json({ error: "Only adaptations hang under a master client." }, { status: 400 });
  }
  if (designerMemberId) {
    const bad = await checkDesigner(admin, designerMemberId);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  }

  // New boxes land at the end of the map, not wherever the database likes.
  const { data: last } = await admin.from("festival_allotment")
    .select("sort").order("sort", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  const sort = (Number(last?.sort) || 0) + 1;

  const { data, error } = await admin.from("festival_allotment").insert({
    kind,
    client_id: clientId,
    designer_member_id: designerMemberId,
    master_client_id: kind === "adaptation" ? masterClientId : null,
    sort,
  }).select("id").single();
  if (error) {
    // unique(client_id) is the one source of truth for "already on the map" —
    // no pre-check here could beat two people adding the same brand at once.
    if (error.code === "23505") {
      return NextResponse.json({ error: `${client.name} is already on the map — move it rather than adding it twice.` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: data.id });
}

/**
 * PATCH — re-point one box. Body: { id, designerMemberId?, masterClientId?, kind? }
 *
 * Moving an adaptation to another master is this with a new masterClientId —
 * exactly what a drag sends, and exactly what the row's select sends.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireAllotment();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  const id = idOrNull(body?.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: node } = await admin.from("festival_allotment")
    .select("id, kind, client_id, master_client_id").eq("id", id).maybeSingle();
  if (!node) return NextResponse.json({ error: "That client is no longer on the map." }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (body.kind !== undefined && !KINDS.includes(body.kind)) {
    return NextResponse.json({ error: "Pick Master, Adaptation or Standalone." }, { status: 400 });
  }
  const kind: Kind = body.kind !== undefined ? body.kind : node.kind;
  if (kind !== node.kind) patch.kind = kind;

  // A master that stops being one would leave its adaptations adapting from
  // nothing, so they have to go somewhere first.
  if (node.kind === "master" && kind !== "master" && (await adaptationsUnder(admin, node.client_id as string)) > 0) {
    return NextResponse.json({ error: "This master still has adaptations under it — move or delete its adaptations first." }, { status: 409 });
  }

  if (kind === "adaptation") {
    const master = body.masterClientId !== undefined ? idOrNull(body.masterClientId) : (node.master_client_id as string | null);
    if (!master) return NextResponse.json({ error: "An adaptation needs the master client it is adapted from." }, { status: 400 });
    if (master !== node.master_client_id) {
      const bad = await checkMaster(admin, master, node.client_id as string);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
      patch.master_client_id = master;
    }
  } else {
    if (idOrNull(body.masterClientId)) {
      return NextResponse.json({ error: "Only adaptations hang under a master client." }, { status: 400 });
    }
    // Leaving adaptation behind leaves its master behind with it.
    if (node.master_client_id) patch.master_client_id = null;
  }

  if (body.designerMemberId !== undefined) {
    const designer = idOrNull(body.designerMemberId);
    if (designer) {
      const bad = await checkDesigner(admin, designer);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    }
    patch.designer_member_id = designer;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ success: true, unchanged: true });

  const { error } = await admin.from("festival_allotment").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/** DELETE — take a client off the map. Body: { id } */
export async function DELETE(request: NextRequest) {
  const guard = await requireAllotment();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  const id = idOrNull(body?.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: node } = await admin.from("festival_allotment").select("kind, client_id").eq("id", id).maybeSingle();
  if (!node) return NextResponse.json({ success: true });

  if (node.kind === "master" && (await adaptationsUnder(admin, node.client_id as string)) > 0) {
    return NextResponse.json({ error: "This master still has adaptations under it — move or delete its adaptations first." }, { status: 409 });
  }

  // Only the map entry goes: tasks already allotted from it belong to their
  // festivals and stay on the board.
  const { error } = await admin.from("festival_allotment").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * Allot — every box on the map becomes a task in the right designer's sheet,
 * in the festival-tasks route's own pattern: the task first, then the festival
 * row that points at it, back-links both ways, and the tasks taken back out if
 * the rows fail to exist.
 *
 * The map IS the assignment, so the PM auto-assign is never asked: a box with
 * no designer becomes an unassigned task, honestly, for someone to pick up.
 */
async function allot(festivalIdRaw: unknown) {
  const festivalId = idOrNull(festivalIdRaw);
  if (!festivalId) return NextResponse.json({ error: "Pick a festival to allot." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: festival } = await admin.from("festivals").select("name, scheduled_at").eq("id", festivalId).maybeSingle();
  if (!festival) return NextResponse.json({ error: "That festival no longer exists." }, { status: 404 });

  const [{ data: nodeRows, error: mapErr }, { data: existing }, { data: clientRows }] = await Promise.all([
    admin.from("festival_allotment")
      .select("id, kind, client_id, designer_member_id, master_client_id, sort, created_at")
      .order("sort", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    admin.from("festival_tasks").select("client_id").eq("festival_id", festivalId),
    admin.from("clients").select("id, name"),
  ]);
  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 });

  const nodes = (nodeRows || []) as NodeRow[];
  if (nodes.length === 0) return NextResponse.json({ error: "The map is empty — add clients to it first." }, { status: 400 });

  const already = new Set((existing || []).map((r) => r.client_id as string));
  const names = new Map((clientRows || []).map((c) => [c.id as string, c.name as string]));
  // A client already on this festival — by an earlier Allot or by hand on the
  // Festivals board — is skipped before any task is made for it.
  const skipped = nodes.filter((n) => already.has(n.client_id)).map((n) => names.get(n.client_id) || "Unknown client");
  const fresh = nodes.filter((n) => !already.has(n.client_id) && names.has(n.client_id));

  if (fresh.length === 0) {
    return NextResponse.json({
      success: true, created: 0, skipped, perDesigner: [],
      message: "Every client on the map is already on this festival.",
    });
  }

  // Masters must exist before anyone can adapt them, so they are due first:
  // master and standalone four days before the festival, adaptations two. A
  // festival that is already nearly here cannot ask for work in the past, so it
  // asks for it now. A festival with no date still needs the work to land
  // somewhere — a week out, with the adapters still trailing by two days.
  const at = festival.scheduled_at ? new Date(festival.scheduled_at as string).getTime() : null;
  const now = Date.now();
  const deadlineFor = (kind: Kind) => {
    const lead = kind === "adaptation" ? 2 : 4;
    return at !== null
      ? new Date(Math.max(at - lead * DAY, now)).toISOString()
      : new Date(now + (kind === "adaptation" ? 9 : 7) * DAY).toISOString();
  };

  // How many adaptations each master carries — the whole map's count, so the
  // master's brief is true even when some adaptations were allotted earlier.
  const adaptCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === "adaptation" && n.master_client_id) {
      adaptCount.set(n.master_client_id, (adaptCount.get(n.master_client_id) || 0) + 1);
    }
  }

  // tasks.assignee_id is a PROFILE id, not a team_members id — Team & Access
  // links the two, and a member with no login simply has no profile. Every
  // designer on the map is looked up once, here, rather than per row.
  const memberIds = [...new Set(fresh.map((n) => n.designer_member_id).filter((id): id is string => !!id))];
  const members = new Map<string, { name: string | null; profileId: string | null }>();
  if (memberIds.length > 0) {
    const { data: memberRows } = await admin.from("team_members").select("id, name, profile_id").in("id", memberIds);
    for (const m of memberRows || []) {
      members.set(m.id as string, { name: (m.name as string | null) || null, profileId: (m.profile_id as string | null) || null });
    }
  }
  /** A designer the map named but Team & Access no longer knows is nobody. */
  const chosen = (n: NodeRow) => (n.designer_member_id ? members.get(n.designer_member_id) || null : null);

  const fest = festival.name as string;
  const brief = (n: NodeRow): { title: string; description: string } => {
    const client = names.get(n.client_id) || "Unknown client";
    if (n.kind === "master") {
      const count = adaptCount.get(n.client_id) || 0;
      return {
        title: `${fest} — ${client} — master creative`,
        description: `Create the original ${fest} creative for ${client}. Adaptations for ${count} client(s) will be made from it.`,
      };
    }
    if (n.kind === "adaptation") {
      const master = (n.master_client_id && names.get(n.master_client_id)) || "its master client";
      return {
        title: `${fest} — ${client} — adapt from ${master}`,
        description: `Adapt ${master}'s ${fest} master creative for ${client}.`,
      };
    }
    return {
      title: `${fest} — ${client} — fresh design`,
      description: `Fresh ${fest} design for ${client} — not adapted from any other client.`,
    };
  };

  const { data: madeTasks, error: taskErr } = await admin
    .from("tasks")
    .insert(fresh.map((n) => {
      const who = chosen(n);
      const { title, description } = brief(n);
      return {
        title,
        description,
        client_id: n.client_id,
        type: "design",
        priority: "medium",
        status: "todo",
        deadline: deadlineFor(n.kind),
        source: "festival",
        // Team Tasks groups its columns by this name, so it is what files the
        // row under the right designer.
        assignee_name: who?.name || null,
        assignee_id: who?.profileId || null,
        metadata: { festival_id: festivalId, allotment_kind: n.kind },
      };
    }))
    .select("id, client_id");
  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });

  const taskByClient = new Map((madeTasks || []).map((t) => [t.client_id as string, t.id as string]));
  const { data: madeRows, error: rowErr } = await admin
    .from("festival_tasks")
    .insert(fresh.map((n) => {
      const who = chosen(n);
      return {
        festival_id: festivalId,
        client_id: n.client_id,
        task_id: taskByClient.get(n.client_id) || null,
        status: "todo",
        tagline: null,
        team_member_id: who ? n.designer_member_id : null,
        assignee_name: who?.name || null,
      };
    }))
    .select("id, client_id");
  if (rowErr) {
    // Never leave tasks on the board for festival rows that failed to exist.
    await admin.from("tasks").delete().in("id", [...taskByClient.values()]);
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }

  // Both directions resolvable: the festival row points at its task, and the
  // task carries the festival row it came from.
  const kindByClient = new Map(fresh.map((n) => [n.client_id, n.kind]));
  for (const row of madeRows || []) {
    const taskId = taskByClient.get(row.client_id as string);
    if (!taskId) continue;
    await admin.from("tasks")
      .update({ metadata: { festival_id: festivalId, festival_task_id: row.id, allotment_kind: kindByClient.get(row.client_id as string) } })
      .eq("id", taskId);
  }

  // Counted from what was actually made, so the summary never claims a task
  // the rollback took away.
  const madeClients = new Set((madeRows || []).map((r) => r.client_id as string));
  const tally = new Map<string, number>();
  for (const n of fresh) {
    if (!madeClients.has(n.client_id)) continue;
    const name = chosen(n)?.name || "Unassigned";
    tally.set(name, (tally.get(name) || 0) + 1);
  }
  const perDesigner = [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const created = madeClients.size;
  return NextResponse.json({
    success: true,
    created,
    skipped,
    perDesigner,
    message: `${created} task${created === 1 ? "" : "s"} created.`,
  });
}
