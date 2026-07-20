export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.CRON_ENABLED === "true") {
      console.log("⏱️ Starting background services...");
      const { startCronScheduler } = await import("./lib/cron-scheduler");
      startCronScheduler();
    } else {
      console.log("⏱️ Background cron services are disabled (CRON_ENABLED is not true).");
    }
  }
}
