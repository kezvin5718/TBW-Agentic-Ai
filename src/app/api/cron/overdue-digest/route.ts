import { NextResponse } from "next/server";
import { runOverdueDigest } from "@/lib/cron-jobs";

export async function GET() {
  try {
    const result = await runOverdueDigest();
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error: unknown) {
    console.error("Overdue Digest Cron Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
