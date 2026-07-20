import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cronSchedulerStatus } from "@/lib/cron-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus = "unhealthy";
  let dbError = null;

  try {
    const supabase = await createClient();
    // Test connection with a lightweight count check
    const { error } = await supabase.from("clients").select("id", { count: "exact", head: true });
    
    if (error) {
      dbError = error.message;
    } else {
      dbStatus = "healthy";
    }
  } catch (err: any) {
    dbError = err.message || "Failed to initialize supabase client";
  }

  // Read app version from package.json dynamically or static fallback
  const appVersion = "1.0.0";

  return NextResponse.json({
    status: dbStatus === "healthy" ? "OK" : "WARNING",
    timestamp: new Date().toISOString(),
    version: appVersion,
    services: {
      database: {
        status: dbStatus,
        error: dbError
      },
      cronScheduler: {
        enabled: process.env.CRON_ENABLED === "true",
        running: cronSchedulerStatus.running,
        jobsCount: cronSchedulerStatus.jobsScheduledCount,
        lastRunTimestamps: cronSchedulerStatus.lastRun
      }
    }
  });
}
