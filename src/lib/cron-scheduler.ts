import cron from "node-cron";
import {
  runAdsAutopilot,
  runLearningLoop,
  runJarvisBriefing,
  runOverdueDigest,
  runPublishingScheduler
} from "@/lib/cron-jobs";
import { runManagerBrief } from "@/lib/manager-brief";

interface CronStatus {
  running: boolean;
  lastRun: Record<string, string>;
  jobsScheduledCount: number;
}

/**
 * Held on globalThis so every bundle sees the same object.
 *
 * instrumentation.ts and the route handlers are compiled separately, so a
 * plain module-level constant gave them one copy each: the scheduler started
 * and set running=true in its own copy, while /api/health read an untouched
 * one and reported the scheduler dead with zero jobs. It had in fact been
 * running the whole time — a health check that cries wolf hides the real
 * outage when it comes.
 */
const STATUS_KEY = Symbol.for("tbw.cronSchedulerStatus");
const globalStore = globalThis as unknown as Record<symbol, CronStatus | undefined>;
globalStore[STATUS_KEY] ??= { running: false, lastRun: {}, jobsScheduledCount: 0 };
export const cronSchedulerStatus: CronStatus = globalStore[STATUS_KEY]!;

/**
 * The same fact as `lastRun` above, written somewhere that survives a deploy.
 *
 * In memory it is useless as a health record: every release wipes it, so a
 * perfectly healthy job reads as "never ran" minutes after a deploy, and a job
 * that genuinely died looks exactly like one that is simply young. Call Notes
 * had never run in production and nobody noticed, because no news looked like
 * good news.
 *
 * `last_success_at` moves only on a success, so a job that starts failing keeps
 * showing when it last genuinely worked. Like logUsage, this must never take
 * down the job it describes — a failed write is swallowed.
 */
async function recordRun(job: string, status: "ok" | "failed", note?: string): Promise<void> {
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      job,
      last_status: status,
      last_note: note ? note.slice(0, 500) : null,
      updated_at: now,
    };
    if (status === "ok") row.last_success_at = now;
    await createServiceRoleClient().from("cron_runs").upsert(row, { onConflict: "job" });
  } catch {
    // Never let bookkeeping take down the work being booked.
  }
}

export function startCronScheduler() {
  if (cronSchedulerStatus.running) {
    console.log("⏱️ In-App Cron: Already running.");
    return;
  }
  
  console.log("⏱️ In-App Cron: Initializing In-App node-cron scheduler (Asia/Kolkata timezone)...");
  cronSchedulerStatus.running = true;

  // 1. Publishing Scheduler (Every 15 minutes)
  cron.schedule("*/15 * * * *", async () => {
    console.log("⏰ In-App Cron: Starting Publishing Scheduler...");
    try {
      const res = await runPublishingScheduler();
      cronSchedulerStatus.lastRun["publishing"] = new Date().toISOString();
      await recordRun("publishing", "ok");
      console.log(`✅ In-App Cron: Publishing completed. Processed: ${res.processed}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Publishing failed:", msg);
      await recordRun("publishing", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 2. Daily Ads Autopilot (Daily at 6:00 AM IST)
  cron.schedule("0 6 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Ads Autopilot...");
    try {
      const res = await runAdsAutopilot();
      cronSchedulerStatus.lastRun["ads_autopilot"] = new Date().toISOString();
      await recordRun("ads_autopilot", "ok");
      console.log(`✅ In-App Cron: Ads Autopilot completed. Logs: ${JSON.stringify(res.logs)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Ads Autopilot failed:", msg);
      await recordRun("ads_autopilot", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 2b. Manager Brief (Daily at 7:45 AM IST — before the founder briefing, so
  // the managers' notes exist by the time anyone asks Bron for them.)
  cron.schedule("45 7 * * *", async () => {
    console.log("⏰ In-App Cron: Building the daily Manager Brief...");
    try {
      const res = await runManagerBrief();
      cronSchedulerStatus.lastRun["manager_brief"] = new Date().toISOString();
      await recordRun("manager_brief", "ok");
      console.log(`✅ In-App Cron: Manager Brief built for ${res.date}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Manager Brief failed:", msg);
      await recordRun("manager_brief", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 3. Morning Briefing (Daily at 8:00 AM IST)
  cron.schedule("0 8 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Jarvis Morning Briefing...");
    try {
      const res = await runJarvisBriefing();
      cronSchedulerStatus.lastRun["morning_briefing"] = new Date().toISOString();
      await recordRun("morning_briefing", "ok");
      console.log(`✅ In-App Cron: Jarvis Briefing completed. Dispatched: ${res.dispatched}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Jarvis Briefing failed:", msg);
      await recordRun("morning_briefing", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 4. Overdue Digest (Daily at 9:00 AM IST)
  cron.schedule("0 9 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Overdue Tasks Digest...");
    try {
      const res = await runOverdueDigest();
      cronSchedulerStatus.lastRun["overdue_digest"] = new Date().toISOString();
      await recordRun("overdue_digest", "ok");
      console.log(`✅ In-App Cron: Overdue Digest completed. Count: ${res.overdueCount}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Overdue Digest failed:", msg);
      await recordRun("overdue_digest", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 5. Weekly Learning Loop (Weekly on Sundays at 11:59 PM IST)
  cron.schedule("59 23 * * 0", async () => {
    console.log("⏰ In-App Cron: Starting Weekly Learning Loop...");
    try {
      const res = await runLearningLoop();
      cronSchedulerStatus.lastRun["weekly_learning_loop"] = new Date().toISOString();
      await recordRun("weekly_learning_loop", "ok");
      console.log(`✅ In-App Cron: Weekly Learning Loop completed. Logs count: ${res.length}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Weekly Learning Loop failed:", msg);
      await recordRun("weekly_learning_loop", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 6d. WhatsApp task bot (every 3 minutes) — clusters each group's messages
  // into conversations and drafts tasks for a human to approve.
  cron.schedule("*/3 * * * *", async () => {
    try {
      const { runWhatsAppTaskBot } = await import("@/lib/wa-task-bot");
      const res = await runWhatsAppTaskBot();
      cronSchedulerStatus.lastRun["wa_task_bot"] = new Date().toISOString();
      await recordRun("wa_task_bot", "ok");
      if (res.drafted > 0) console.log(`✅ In-App Cron: WhatsApp bot drafted ${res.drafted} task(s) from ${res.clusters} conversation(s).`);
      for (const e of res.errors) console.warn("   ↳ wa-bot:", e);
    } catch (err: unknown) {
      console.error("❌ In-App Cron: WhatsApp task bot failed:", err instanceof Error ? err.message : String(err));
      await recordRun("wa_task_bot", "failed", err instanceof Error ? err.message : String(err));
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 6b. Call recordings synced from phones into Drive (every 5 minutes).
  // Transcribing is slow and costs money per minute, so this runs less often
  // than the WhatsApp bot and caps how many files it takes per sweep.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const { sweepCallFolders } = await import("@/lib/call-watcher");
      const res = await sweepCallFolders();
      cronSchedulerStatus.lastRun["call_watcher"] = new Date().toISOString();
      await recordRun("call_watcher", "ok");
      if (res.processed > 0) console.log(`✅ In-App Cron: turned ${res.processed} call recording(s) into task drafts.`);
      if (res.failed > 0) for (const n of res.notes) console.warn("   ↳ call-watcher:", n);
    } catch (err: unknown) {
      console.error("❌ In-App Cron: call watcher failed:", err instanceof Error ? err.message : String(err));
      await recordRun("call_watcher", "failed", err instanceof Error ? err.message : String(err));
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 7. Storage sweep (3:30 AM IST) — move spent files to Drive, free Supabase.
  cron.schedule("30 3 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Storage Sweep...");
    try {
      const { sweepAll } = await import("@/lib/storage-archiver");
      const res = await sweepAll();
      cronSchedulerStatus.lastRun["storage_sweep"] = new Date().toISOString();
      await recordRun("storage_sweep", "ok");
      const mb = (res.freedBytes / 1024 / 1024).toFixed(1);
      console.log(`✅ In-App Cron: Storage sweep freed ${mb} MB (${res.references.archived} refs, ${res.social.archived} post files).`);
      for (const e of [...res.references.errors, ...res.social.errors]) console.warn("   ↳ sweep:", e);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Storage sweep failed:", msg);
      await recordRun("storage_sweep", "failed", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  console.log(`⏱️ In-App Cron: Scheduler active. Total jobs scheduled: ${cronSchedulerStatus.jobsScheduledCount}`);
}
export default startCronScheduler;
