import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { istToday, utcToIstWallClock } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Grids & Ads — the founder's Google-Sheet tracker, live.
 *
 * Every active client is a row. The three "until" columns are never typed:
 * they are read off the posting calendar each time the board loads, so they
 * cannot go stale the way the sheet's did. Only the ownership and money
 * columns are hand-edited, and only by the founder or someone he has named
 * (profiles.can_update_grid_ads).
 */

type Admin = ReturnType<typeof createServiceRoleClient>;

/** Posts that hold a day on the calendar — the same two statuses the automation route counts. */
const OCCUPYING_STATUSES = ["sent", "published"];

/** The IST calendar day an instant falls on, as "YYYY-MM-DD" — the automation route's day math. */
function istDayOf(instant: string): string {
  return utcToIstWallClock(instant).slice(0, 10);
}

const MEMBER_FIELDS = ["scheduling_member_id", "ads_member_id", "content_member_id"] as const;
const TEXT_FIELDS = ["funds", "google_funds", "ad_budget_monthly"] as const;
const REPORT_VALUES = ["done", "pending"];
const ALLOWED_FIELDS = new Set<string>([...MEMBER_FIELDS, ...TEXT_FIELDS, "monthly_report"]);
const TEXT_MAX = 120;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRACKER_COLUMNS = "client_id, scheduling_member_id, ads_member_id, content_member_id, funds, google_funds, ad_budget_monthly, monthly_report, updated_at, updated_by";

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) return { user: null, role };
  return { user, role };
}

/**
 * Who may type into the tracker. Founders always; employees only by named
 * grant (profiles.can_update_grid_ads) — the same shape as moving tasks on the
 * team board. The money columns are what the founder reads to decide spend,
 * so who keeps them honest is his decision, not the whole team's.
 */
async function mayUpdateGridAds(userId: string, role: string): Promise<boolean> {
  if (role === "founder") return true;
  if (role !== "employee") return false;
  const admin = createServiceRoleClient();
  const { data } = await admin.from("profiles").select("can_update_grid_ads").eq("id", userId).maybeSingle();
  return !!data?.can_update_grid_ads;
}

interface Until { endDate: string | null; pinterestUntil: string | null; youtubeUntil: string | null }

/**
 * The calendar's last day per client, for every client at once.
 *
 * One read of social_posts for the whole agency, grouped here — never a query
 * per client. A post's day is coalesce(scheduled_for, created_at) in IST: its
 * slot, or for one sent straight out, the moment it went. endDate is the feed
 * calendar's end (anything but a Story, any platform); Pinterest and YouTube
 * keep their own last day whatever the content type. Stories are only
 * fetched where they could matter — on those two platforms.
 *
 * PostgREST hands back at most 1,000 rows a response, so the one query is
 * read in pages; ~3k rows today is a handful of narrow pages.
 */
async function untilByClient(admin: Admin): Promise<Map<string, Until>> {
  const PAGE = 1000;
  const MAX_PAGES = 50;
  const out = new Map<string, Until>();
  const later = (a: string | null, b: string) => (!a || b > a ? b : a);

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("social_posts")
      .select("id, client_id, platform, content_type, scheduled_for, created_at")
      .in("status", OCCUPYING_STATUSES)
      // A row with no content type was a feed post (the automation route's
      // guard); a Story only counts on Pinterest/YouTube.
      .or("content_type.is.null,content_type.neq.story,platform.in.(pinterest,youtube)")
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];

    for (const r of rows) {
      const instant = (r.scheduled_for as string | null) || (r.created_at as string | null);
      if (!instant || !r.client_id) continue;
      const day = istDayOf(instant);
      const u = out.get(r.client_id as string) || { endDate: null, pinterestUntil: null, youtubeUntil: null };
      if (r.content_type !== "story") u.endDate = later(u.endDate, day);
      if (r.platform === "pinterest") u.pinterestUntil = later(u.pinterestUntil, day);
      if (r.platform === "youtube") u.youtubeUntil = later(u.youtubeUntil, day);
      out.set(r.client_id as string, u);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * GET /api/grid-ads — the whole board in one payload.
 *
 * Rows come back already in the sheet's order: run-out (end date today or
 * past) first, then the soonest end date, then clients with nothing booked —
 * alphabetical within each group, by date first in the middle one.
 */
export async function GET() {
  const { user, role } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const today = istToday();

  let until: Map<string, Until>;
  try {
    until = await untilByClient(admin);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read the calendar" }, { status: 500 });
  }

  const [clientsRes, trackerRes, teamRes, profsRes, canEdit] = await Promise.all([
    admin.from("clients").select("id, name").is("archived_at", null).order("name"),
    admin.from("grid_ads_tracker").select(TRACKER_COLUMNS),
    admin.from("team_members").select("id, name, role_title, profile_id, active").order("name"),
    admin.from("profiles").select("id, avatar_url, designation"),
    mayUpdateGridAds(user.id, role),
  ]);
  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  if (trackerRes.error) return NextResponse.json({ error: trackerRes.error.message }, { status: 500 });
  if (teamRes.error) return NextResponse.json({ error: teamRes.error.message }, { status: 500 });

  const trackerBy = new Map((trackerRes.data || []).map((t) => [t.client_id as string, t]));

  // Faces and designations the same way the team board attaches them. Active
  // members fill the dropdowns; a switched-off one still named on a row is
  // sent too, so the row can say who it was rather than going blank.
  const byProfile = new Map((profsRes.data || []).map((p) => [p.id as string, p]));
  const referenced = new Set<string>();
  for (const t of trackerRes.data || []) for (const f of MEMBER_FIELDS) if (t[f]) referenced.add(t[f] as string);
  const team = (teamRes.data || [])
    .filter((m) => m.active || referenced.has(m.id as string))
    .map((m) => {
      const prof = m.profile_id ? byProfile.get(m.profile_id as string) : null;
      return {
        id: m.id as string,
        name: m.name as string,
        active: !!m.active,
        avatar_url: (prof?.avatar_url as string | null) || null,
        role_title: (m.role_title as string | null) || (prof?.designation as string | null) || null,
      };
    });

  const rows = (clientsRes.data || []).map((c) => {
    const u = until.get(c.id as string) || { endDate: null, pinterestUntil: null, youtubeUntil: null };
    const t = trackerBy.get(c.id as string);
    return {
      clientId: c.id as string,
      clientName: (c.name as string) || "",
      ...u,
      tracker: {
        scheduling_member_id: (t?.scheduling_member_id as string | null) ?? null,
        ads_member_id: (t?.ads_member_id as string | null) ?? null,
        content_member_id: (t?.content_member_id as string | null) ?? null,
        funds: (t?.funds as string | null) ?? null,
        google_funds: (t?.google_funds as string | null) ?? null,
        ad_budget_monthly: (t?.ad_budget_monthly as string | null) ?? null,
        monthly_report: (t?.monthly_report as "done" | "pending" | null) ?? null,
        updated_at: (t?.updated_at as string | null) ?? null,
        updated_by: (t?.updated_by as string | null) ?? null,
      },
    };
  });

  // 0 = ran out (today or past), 1 = still booked ahead, 2 = nothing ever booked.
  const group = (d: string | null) => (!d ? 2 : d <= today ? 0 : 1);
  rows.sort((a, b) => {
    const ga = group(a.endDate), gb = group(b.endDate);
    if (ga !== gb) return ga - gb;
    if (ga === 1 && a.endDate !== b.endDate) return (a.endDate as string) < (b.endDate as string) ? -1 : 1;
    return a.clientName.localeCompare(b.clientName);
  });

  return NextResponse.json({ success: true, today, canEdit, team, rows });
}

/**
 * PATCH /api/grid-ads — { clientId, fields } for one cell (or a few).
 *
 * Only the typed columns, and only by the founder or a named grant; checked
 * here, not trusted from the screen that hides the inputs. Upserts the
 * client's tracker row and stamps who and when.
 */
export async function PATCH(request: NextRequest) {
  const { user, role } = await requireStaff();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await mayUpdateGridAds(user.id, role))) {
    return NextResponse.json({ error: "You don't have permission to update Grids & Ads — ask the founder to grant it in Team & Access." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { clientId?: unknown; fields?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  const fields = body?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return NextResponse.json({ error: "fields is required" }, { status: 400 });
  }
  const input = fields as Record<string, unknown>;

  const unknownKeys = Object.keys(input).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknownKeys.length) {
    return NextResponse.json({ error: `Not an editable column: ${unknownKeys.join(", ")}` }, { status: 400 });
  }

  const patch: Record<string, string | null> = {};

  // Owners: a team_members id, or null to clear.
  const memberIds: string[] = [];
  for (const f of MEMBER_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (v === null || v === "") { patch[f] = null; continue; }
    if (typeof v !== "string" || !UUID_RE.test(v)) return NextResponse.json({ error: `${f} must be a team member id or null` }, { status: 400 });
    patch[f] = v;
    memberIds.push(v);
  }

  // Money columns are free text in the sheet ("₹20k + GST", "paid till Oct"):
  // trimmed, held to 120 characters, and a blank clears.
  for (const f of TEXT_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (v === null) { patch[f] = null; continue; }
    if (typeof v !== "string" && typeof v !== "number") return NextResponse.json({ error: `${f} must be text or null` }, { status: 400 });
    const s = String(v).trim().slice(0, TEXT_MAX).trim();
    patch[f] = s || null;
  }

  if ("monthly_report" in input) {
    const v = input.monthly_report;
    if (v !== null && !(typeof v === "string" && REPORT_VALUES.includes(v))) {
      return NextResponse.json({ error: "monthly_report must be 'done', 'pending' or null" }, { status: 400 });
    }
    patch.monthly_report = v as string | null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const admin = createServiceRoleClient();

  const [{ data: client }, membersRes] = await Promise.all([
    admin.from("clients").select("id, archived_at").eq("id", clientId).maybeSingle(),
    memberIds.length
      ? admin.from("team_members").select("id").in("id", Array.from(new Set(memberIds)))
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);
  if (!client || client.archived_at) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  const known = new Set((membersRes.data || []).map((m) => m.id as string));
  const missing = memberIds.filter((id) => !known.has(id));
  if (missing.length) return NextResponse.json({ error: "That team member no longer exists — refresh and pick again." }, { status: 400 });

  // merge-duplicates writes only the columns sent, so one cell's save never
  // blanks the others on an existing row.
  const { data, error } = await admin
    .from("grid_ads_tracker")
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "client_id" })
    .select(TRACKER_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, tracker: data });
}
