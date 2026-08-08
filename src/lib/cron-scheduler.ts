import cron from "node-cron";
import {
  runAdsAutopilot,
  runLearningLoop,
  runJarvisBriefing,
  runOverdueDigest,
  runPublishingScheduler
} from "@/lib/cron-jobs";

export const cronSchedulerStatus = {
  running: false,
  lastRun: {} as Record<string, string>,
  jobsScheduledCount: 0
};

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
      console.log(`✅ In-App Cron: Publishing completed. Processed: ${res.processed}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Publishing failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 2. Daily Ads Autopilot (Daily at 6:00 AM IST)
  cron.schedule("0 6 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Ads Autopilot...");
    try {
      const res = await runAdsAutopilot();
      cronSchedulerStatus.lastRun["ads_autopilot"] = new Date().toISOString();
      console.log(`✅ In-App Cron: Ads Autopilot completed. Logs: ${JSON.stringify(res.logs)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Ads Autopilot failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 3. Morning Briefing (Daily at 8:00 AM IST)
  cron.schedule("0 8 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Jarvis Morning Briefing...");
    try {
      const res = await runJarvisBriefing();
      cronSchedulerStatus.lastRun["morning_briefing"] = new Date().toISOString();
      console.log(`✅ In-App Cron: Jarvis Briefing completed. Dispatched: ${res.dispatched}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Jarvis Briefing failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 4. Overdue Digest (Daily at 9:00 AM IST)
  cron.schedule("0 9 * * *", async () => {
    console.log("⏰ In-App Cron: Starting Overdue Tasks Digest...");
    try {
      const res = await runOverdueDigest();
      cronSchedulerStatus.lastRun["overdue_digest"] = new Date().toISOString();
      console.log(`✅ In-App Cron: Overdue Digest completed. Count: ${res.overdueCount}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Overdue Digest failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 5. Weekly Learning Loop (Weekly on Sundays at 11:59 PM IST)
  cron.schedule("59 23 * * 0", async () => {
    console.log("⏰ In-App Cron: Starting Weekly Learning Loop...");
    try {
      const res = await runLearningLoop();
      cronSchedulerStatus.lastRun["weekly_learning_loop"] = new Date().toISOString();
      console.log(`✅ In-App Cron: Weekly Learning Loop completed. Logs count: ${res.length}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Weekly Learning Loop failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 6a. Founder Portfolio Intraday Alert Watcher (every 15 min; self-guards to market hours, no LLM)
  cron.schedule("*/15 9-16 * * 1-5", async () => {
    try {
      const { runIntradayWatch } = await import("@/lib/portfolio-monitor");
      const res = await runIntradayWatch();
      if (res.checked > 0) {
        cronSchedulerStatus.lastRun["portfolio_watch"] = new Date().toISOString();
        if (res.fired > 0)
          console.log(`🚨 In-App Cron: Portfolio watcher filed ${res.fired} alert(s) in journal.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Portfolio watcher failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 6b. Founder Portfolio EOD Logger (Weekdays at 3:45 PM IST, after market close)
  cron.schedule("45 15 * * 1-5", async () => {
    console.log("⏰ In-App Cron: Logging Founder Portfolio EOD snapshot...");
    try {
      const { runEodLog } = await import("@/lib/portfolio-monitor");
      const res = await runEodLog();
      cronSchedulerStatus.lastRun["portfolio_eod"] = new Date().toISOString();
      console.log(`✅ In-App Cron: EOD logged. Portfolio value ₹${(res.totalValue / 1e5).toFixed(2)}L`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Portfolio EOD log failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  // 6c. Founder Portfolio Morning Brief (Weekdays at 8:45 AM IST, before market open)
  cron.schedule("45 8 * * 1-5", async () => {
    console.log("⏰ In-App Cron: Starting Founder Portfolio Morning Brief...");
    try {
      const { runPortfolioMorningBrief } = await import("@/lib/portfolio-brief");
      await runPortfolioMorningBrief();
      cronSchedulerStatus.lastRun["portfolio_brief"] = new Date().toISOString();
      console.log("✅ In-App Cron: Portfolio Morning Brief filed in founder journal.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Portfolio Morning Brief failed:", msg);
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
      if (res.drafted > 0) console.log(`✅ In-App Cron: WhatsApp bot drafted ${res.drafted} task(s) from ${res.clusters} conversation(s).`);
      for (const e of res.errors) console.warn("   ↳ wa-bot:", e);
    } catch (err: unknown) {
      console.error("❌ In-App Cron: WhatsApp task bot failed:", err instanceof Error ? err.message : String(err));
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
      if (res.processed > 0) console.log(`✅ In-App Cron: turned ${res.processed} call recording(s) into task drafts.`);
      if (res.failed > 0) for (const n of res.notes) console.warn("   ↳ call-watcher:", n);
    } catch (err: unknown) {
      console.error("❌ In-App Cron: call watcher failed:", err instanceof Error ? err.message : String(err));
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
      const mb = (res.freedBytes / 1024 / 1024).toFixed(1);
      console.log(`✅ In-App Cron: Storage sweep freed ${mb} MB (${res.references.archived} refs, ${res.social.archived} post files).`);
      for (const e of [...res.references.errors, ...res.social.errors]) console.warn("   ↳ sweep:", e);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ In-App Cron: Storage sweep failed:", msg);
    }
  }, { timezone: "Asia/Kolkata" });
  cronSchedulerStatus.jobsScheduledCount++;

  console.log(`⏱️ In-App Cron: Scheduler active. Total jobs scheduled: ${cronSchedulerStatus.jobsScheduledCount}`);
}
export default startCronScheduler;
