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

  console.log(`⏱️ In-App Cron: Scheduler active. Total jobs scheduled: ${cronSchedulerStatus.jobsScheduledCount}`);
}
export default startCronScheduler;
