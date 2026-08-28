import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * The AI Project Manager's routing brain — and there is no AI in it.
 *
 * Who should do a piece of work is already written down: months of rows in
 * `tasks`, every (client, type) → assignee pair the agency has ever made. This
 * reads that history, discounts what is old, subtracts what someone is already
 * carrying, and names the person. No model call, no invention — if the history
 * is thin it says so and hands back the least busy person instead of guessing
 * confidently.
 */

export interface RouteSuggestion {
  teamMemberId: string | null;
  profileId: string | null;
  name: string;
  /** "14 of this client's last 16 design tasks · load 8" */
  reason: string;
  confidence: "high" | "medium" | "low";
  alternates: { name: string; reason: string }[];
}

interface MemberRow {
  id: string;
  name: string;
  role_title: string | null;
  department: string | null;
  profile_id: string | null;
  away_until: string | null;
}

interface TaskRow {
  assignee_name: string | null;
  client_id: string | null;
  type: string | null;
  status: string | null;
  created_at: string;
}

/**
 * Which department does this kind of work belong to?
 *
 * `team_members.department` is free text a human typed, so nothing is matched
 * exactly: each task type carries the words that would plausibly appear in the
 * department of whoever does it, and the first department containing one of
 * them wins. When nothing matches — including the very common case of the
 * column being empty altogether — the caller falls back to the least-loaded
 * active member, which is the honest answer rather than a wrong one.
 */
const DEPARTMENT_WORDS: Record<string, string[]> = {
  design: ["design", "graphic", "creative", "art"],
  image: ["design", "graphic", "creative", "art"],
  packaging: ["design", "graphic", "print", "packaging"],
  print: ["print", "design", "graphic", "packaging"],
  video: ["video", "edit", "motion", "film"],
  video_edit: ["video", "edit", "motion", "film"],
  ai_video: ["video", "edit", "motion", "ai"],
  copy: ["copy", "content", "writ"],
  script: ["copy", "content", "writ", "script"],
  planning: ["plan", "strategy", "account", "manage"],
  ads: ["ads", "perform", "media", "market"],
  other: [],
};

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Away today, or away until some day still ahead of us. */
function isAway(member: MemberRow, today: string): boolean {
  return !!member.away_until && member.away_until >= today;
}

/** Work in the last 30 days counts fully; older work counts half. */
function recencyWeight(createdAt: string, now: number): number {
  const age = now - Date.parse(createdAt);
  return age <= 30 * 86400000 ? 1 : 0.5;
}

/** The department whose name shares a word with this task type. */
function departmentFor(taskType: string | null | undefined, members: MemberRow[]): string | null {
  const words = DEPARTMENT_WORDS[String(taskType || "").toLowerCase()] || [];
  if (words.length === 0) return null;
  for (const m of members) {
    const dept = (m.department || "").toLowerCase().trim();
    if (dept && words.some((w) => dept.includes(w))) return dept;
  }
  return null;
}

export async function suggestAssignee(input: {
  clientId?: string | null;
  taskType?: string | null;
}): Promise<RouteSuggestion | null> {
  const admin = createServiceRoleClient();
  const today = istToday();
  const now = Date.now();

  const [{ data: memberRows }, { data: taskRows }] = await Promise.all([
    admin.from("team_members").select("id, name, role_title, department, profile_id, away_until").eq("active", true),
    admin
      .from("tasks")
      .select("assignee_name, client_id, type, status, created_at")
      .not("assignee_name", "is", null)
      .gte("created_at", new Date(now - 180 * 86400000).toISOString()),
  ]);

  const members = (memberRows || []) as MemberRow[];
  if (members.length === 0) return null;
  const tasks = (taskRows || []) as TaskRow[];

  // Everyone still has a load, even the people history rules out — a fair
  // fallback needs to know who is actually free.
  const loadByName = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    const name = (t.assignee_name || "").toLowerCase().trim();
    if (name) loadByName.set(name, (loadByName.get(name) || 0) + 1);
  }
  const loadOf = (m: MemberRow) => loadByName.get(m.name.toLowerCase().trim()) || 0;

  const available = members.filter((m) => !isAway(m, today));
  const leastLoaded = (pool: MemberRow[]) =>
    [...pool].sort((a, b) => loadOf(a) - loadOf(b) || a.name.localeCompare(b.name))[0] || null;

  const wantedClient = input.clientId || null;
  const wantedType = (input.taskType || "").toLowerCase().trim() || null;

  // Score every available member on what they have actually done.
  const scored = available.map((m) => {
    const mine = tasks.filter((t) => (t.assignee_name || "").toLowerCase().trim() === m.name.toLowerCase().trim());
    let points = 0;
    let sameClientType = 0;
    let relevant = 0;
    for (const t of mine) {
      const sameClient = !!wantedClient && t.client_id === wantedClient;
      const sameType = !!wantedType && (t.type || "").toLowerCase().trim() === wantedType;
      const base = sameClient && sameType ? 3 : sameClient ? 2 : sameType ? 1 : 0;
      if (base === 0) continue;
      points += base * recencyWeight(t.created_at, now);
      relevant++;
      if (sameClient && sameType) sameClientType++;
    }
    return { member: m, points, relevant, sameClientType, clientTasks: mine.filter((t) => !!wantedClient && t.client_id === wantedClient).length };
  });

  // Somebody with no relevant history is not a candidate — they are a guess.
  const candidates = scored
    .filter((c) => c.relevant > 0)
    .map((c) => ({ ...c, net: c.points - loadOf(c.member) * 0.5 }))
    .sort((a, b) => b.net - a.net);

  const best = candidates[0];
  const runnerUp = candidates[1];
  const totalRelevant = candidates.reduce((n, c) => n + c.relevant, 0);

  // Thin history is the one case where confidence would be a lie. Fall back to
  // whoever in the right department is carrying least — and say exactly that.
  if (!best || totalRelevant < 3) {
    const dept = departmentFor(wantedType, members);
    const pool = dept
      ? available.filter((m) => (m.department || "").toLowerCase().trim() === dept)
      : [];
    const pick = leastLoaded(pool.length > 0 ? pool : available);
    if (!pick) return null;
    return {
      teamMemberId: pick.id,
      profileId: pick.profile_id,
      name: pick.name,
      reason: `no history — least busy in ${dept || pick.department || "the team"} · load ${loadOf(pick)}`,
      confidence: "low",
      alternates: leastLoadedAlternates(pool.length > 0 ? pool : available, pick, loadOf),
    };
  }

  const load = loadOf(best.member);
  const reason = best.sameClientType > 0 && wantedClient && wantedType
    ? `${best.sameClientType} of this client's last ${best.clientTasks} ${wantedType} tasks · load ${load}`
    : `${best.relevant} matching task${best.relevant === 1 ? "" : "s"} in the last 180 days · load ${load}`;

  const clear = !runnerUp || best.net >= 1.5 * Math.max(runnerUp.net, 0.01);
  return {
    teamMemberId: best.member.id,
    profileId: best.member.profile_id,
    name: best.member.name,
    reason,
    confidence: best.points >= 8 && clear ? "high" : "medium",
    alternates: candidates.slice(1, 3).map((c) => ({
      name: c.member.name,
      reason: `${c.relevant} matching task${c.relevant === 1 ? "" : "s"} · load ${loadOf(c.member)}`,
    })),
  };
}

/** Up to two other people who could take it, least busy first. */
function leastLoadedAlternates(pool: MemberRow[], chosen: MemberRow, loadOf: (m: MemberRow) => number) {
  return [...pool]
    .filter((m) => m.id !== chosen.id)
    .sort((a, b) => loadOf(a) - loadOf(b) || a.name.localeCompare(b.name))
    .slice(0, 2)
    .map((m) => ({ name: m.name, reason: `load ${loadOf(m)}` }));
}
