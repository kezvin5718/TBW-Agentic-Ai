import { NextResponse } from "next/server";
import { runAdsAutopilot } from "@/lib/ads-autopilot";

export async function GET(request: Request) {
  // Verify Vercel Cron signature
  const authHeader = request.headers.get("authorization");
  
  if (
    process.env.NODE_ENV === "production" &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    console.error("Cron authentication failed. Access denied.");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  console.log("Vercel Cron: Running Ads Optimization Autopilot...");

  try {
    const res = await runAdsAutopilot();
    return NextResponse.json({
      success: true,
      message: "Daily ads autopilot optimization completed successfully",
      logs: res.logs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Vercel Cron Autopilot execution failed:", error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal Autopilot Cron Error",
      },
      { status: 550 }
    );
  }
}

// POST endpoint for manual trigger via dashboard workspace quick-action
export async function POST() {
  try {
    const res = await runAdsAutopilot();
    return NextResponse.json({
      success: true,
      message: "Manual ads autopilot execution completed",
      logs: res.logs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Manual Autopilot trigger failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
