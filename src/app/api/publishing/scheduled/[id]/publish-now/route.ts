import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executePublishForScheduledPost } from "@/lib/publish-executor";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const role = user.user_metadata?.role;
    if (role !== "founder" && role !== "employee") {
      return new NextResponse("Forbidden: Only Founders/Employees can override publication", { status: 403 });
    }

    const res = await executePublishForScheduledPost(id);

    if (!res.success) {
      return NextResponse.json({ error: res.error || "Override publish dispatch failed" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      platformPostId: res.platformPostId,
    });
  } catch (error: unknown) {
    console.error("Scheduled post override publish error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
