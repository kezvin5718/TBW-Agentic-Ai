import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cronSchedulerStatus } from "@/lib/cron-scheduler";

export const dynamic = "force-dynamic";

// Whether the nine background jobs are still alive is the founder's business,
// and nobody else's.
async function requireFounder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (role !== "founder") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * The nine jobs the scheduler runs, and how long each may reasonably go unseen.
 *
 * "Quiet after" is deliberately generous — roughly three missed runs for the
 * frequent jobs, one missed day for the daily ones. An alarm that cries wolf
 * gets ignored, and being ignored is the failure this whole strip exists to
 * prevent.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const JOBS: { key: string; label: string; schedule: string; quietAfterMs: number }[] = [
  { key: "publishing", label: "Publishing scheduler", schedule: "every 15 min", quietAfterMs: 45 * MIN },
  { key: "wa_task_bot", label: "WhatsApp task bot", schedule: "every 3 min", quietAfterMs: 20 * MIN },
  { key: "call_watcher", label: "Call recordings sweep", schedule: "every 5 min", quietAfterMs: 30 * MIN },
  { key: "ads_autopilot", label: "Ads autopilot", schedule: "06:00 daily", quietAfterMs: 26 * HOUR },
  { key: "manager_brief", label: "Manager brief", schedule: "07:45 daily", quietAfterMs: 26 * HOUR },
  { key: "morning_briefing", label: "Morning briefing", schedule: "08:00 daily", quietAfterMs: 26 * HOUR },
  { key: "overdue_digest", label: "Overdue digest", schedule: "09:00 daily", quietAfterMs: 26 * HOUR },
  { key: "storage_sweep", label: "Storage sweep", schedule: "03:30 daily", quietAfterMs: 26 * HOUR },
  { key: "weekly_learning_loop", label: "Weekly learning loop", schedule: "Sun 23:59", quietAfterMs: 8 * 24 * HOUR },
];

interface RunRow {
  job: string;
  last_success_at: string | null;
  last_status: string | null;
  last_note: string | null;
}

/** GET — did everything run? */
export async function GET() {
  const guard = await requireFounder();
  if (guard.error) return guard.error;

  // The whole scheduler only starts when this is set on the server. Without it
  // none of the nine run at all, and no job below can be judged — which is a
  // different answer from "they all died".
  const cronEnabled = process.env.CRON_ENABLED === "true";

  const admin = createServiceRoleClient();
  const { data } = await admin.from("cron_runs").select("job, last_success_at, last_status, last_note");
  const byJob = new Map((data as RunRow[] | null || []).map((r) => [r.job, r]));

  const now = Date.now();
  const jobs = JOBS.map((j) => {
    const row = byJob.get(j.key);
    const lastSuccessAt = row?.last_success_at || null;
    const state = !cronEnabled
      ? "off"
      : !row
      ? "never"
      : row.last_status === "failed"
      ? "failing"
      : !lastSuccessAt || now - Date.parse(lastSuccessAt) > j.quietAfterMs
      ? "quiet"
      : "ok";
    return {
      key: j.key,
      label: j.label,
      schedule: j.schedule,
      state,
      lastSuccessAt,
      lastNote: row?.last_note || null,
    };
  });

  return NextResponse.json({
    success: true,
    cronEnabled,
    schedulerRunning: cronSchedulerStatus.running,
    jobs,
  });
}
