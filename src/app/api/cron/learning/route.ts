import { NextResponse } from "next/server";
import { runLearningLoop } from "@/lib/cron-jobs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const logs = await runLearningLoop();
    return NextResponse.json({
      success: true,
      message: "Weekly learning loop cron executed successfully",
      logs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Weekly learning loop cron failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal Learning Loop Cron Error",
      },
      { status: 550 }
    );
  }
}
