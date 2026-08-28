import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 60;
const DAY = 86400000;

interface Profile {
  id: string;
  name: string;
  openLoad: number;
  doneCount: number;
  /** null when nobody finished anything with a deadline to be measured against. */
  onTimePct: number | null;
  /** The two kinds of work they do most, with how long each usually takes. */
  speed: { type: string; medianDays: number; count: number }[];
  /** null when none of their tasks carry a creative we can judge. */
  qcPassPct: number | null;
  topClients: { name: string; count: number }[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * GET — what each member's last two months actually look like.
 *
 * Computed live rather than stored: these are four reads and some arithmetic,
 * and a stored version would be one more thing to keep true. Everything here
 * is a fact about work already done — no scores, no ranking, no judgement.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();

  const [{ data: members }, { data: tasks }, { data: creatives }, { data: clients }] = await Promise.all([
    admin.from("team_members").select("id, name").eq("active", true).order("name"),
    admin.from("tasks").select("id, assignee_name, client_id, type, status, deadline, completed_at, created_at").gte("created_at", since),
    admin.from("creatives").select("task_id, qc_status").not("task_id", "is", null).gte("created_at", since),
    admin.from("clients").select("id, name"),
  ]);

  const clientName = new Map((clients || []).map((c) => [c.id as string, c.name as string]));

  // Which member owns each task, so a creative can be traced back to a person.
  const ownerOfTask = new Map<string, string>();
  for (const t of tasks || []) {
    const name = String(t.assignee_name || "").toLowerCase().trim();
    if (name) ownerOfTask.set(t.id as string, name);
  }
  const qcByOwner = new Map<string, { passed: number; judged: number }>();
  for (const c of creatives || []) {
    const owner = ownerOfTask.get(c.task_id as string);
    // A creative nobody's task claims tells us nothing about anybody.
    if (!owner) continue;
    if (c.qc_status !== "passed" && c.qc_status !== "failed") continue;
    const row = qcByOwner.get(owner) || { passed: 0, judged: 0 };
    row.judged++;
    if (c.qc_status === "passed") row.passed++;
    qcByOwner.set(owner, row);
  }

  const profiles: Profile[] = (members || []).map((m) => {
    const key = String(m.name || "").toLowerCase().trim();
    const mine = (tasks || []).filter((t) => String(t.assignee_name || "").toLowerCase().trim() === key);
    const done = mine.filter((t) => t.status === "done" && t.completed_at);

    const measurable = done.filter((t) => !!t.deadline);
    const onTime = measurable.filter((t) => Date.parse(t.completed_at as string) <= Date.parse(t.deadline as string));

    const daysByType = new Map<string, number[]>();
    for (const t of done) {
      const type = String(t.type || "other");
      const days = (Date.parse(t.completed_at as string) - Date.parse(t.created_at as string)) / DAY;
      if (!Number.isFinite(days) || days < 0) continue;
      daysByType.set(type, [...(daysByType.get(type) || []), days]);
    }
    const speed = [...daysByType.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 2)
      .map(([type, list]) => ({ type, medianDays: Math.round(median(list) * 10) / 10, count: list.length }));

    const byClient = new Map<string, number>();
    for (const t of mine) {
      if (!t.client_id) continue;
      byClient.set(t.client_id as string, (byClient.get(t.client_id as string) || 0) + 1);
    }
    const topClients = [...byClient.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ name: clientName.get(id) || "?", count }));

    const qc = qcByOwner.get(key);

    return {
      id: m.id as string,
      name: m.name as string,
      openLoad: mine.filter((t) => t.status !== "done").length,
      doneCount: done.length,
      onTimePct: measurable.length > 0 ? Math.round((onTime.length / measurable.length) * 100) : null,
      speed,
      qcPassPct: qc && qc.judged > 0 ? Math.round((qc.passed / qc.judged) * 100) : null,
      topClients,
    };
  });

  return NextResponse.json({ success: true, windowDays: WINDOW_DAYS, profiles });
}
