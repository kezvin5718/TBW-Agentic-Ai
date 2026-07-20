import { NextResponse } from "next/server";
import { runPublishingScheduler } from "@/lib/cron-jobs";

export async function GET() {
  try {
    const result = await runPublishingScheduler();
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error: unknown) {
    console.error("Publishing Cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
