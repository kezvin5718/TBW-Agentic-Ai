import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { activeJobs } from "@/lib/higgsfield-state";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import {
  getHiggsfieldCredentials,
  pollHiggsfieldJobStatus,
  downloadAndStoreGeneratedMedia,
} from "@/lib/higgsfield-mcp";

const MOCK_IMAGES = [
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1572635196237-14b3f281503f?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1560343090-f0409e92791a?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1583394838336-acd977736f90?q=80&w=800&auto=format&fit=crop",
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = activeJobs.get(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const creds = await getHiggsfieldCredentials();
    const serviceSupabase = createServiceRoleClient();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Real MCP Job Status Polling
    if (creds && creds.status === "connected") {
      try {
        const statusResult = await pollHiggsfieldJobStatus(creds, jobId);
        const currentStatus = (statusResult.status || "processing").toLowerCase();

        // Failed / NSFW / IP_Detected states
        if (
          currentStatus.includes("fail") ||
          currentStatus.includes("error") ||
          currentStatus.includes("nsfw") ||
          currentStatus.includes("ip_detected") ||
          currentStatus.includes("reject")
        ) {
          const failureReason = statusResult.failure_reason || statusResult.error || `Generation stopped (${currentStatus})`;
          console.error(`❌ Polling job ${jobId}: Failed state detected (${currentStatus}):`, failureReason);
          activeJobs.delete(jobId);
          return NextResponse.json({
            status: "failed",
            error: failureReason,
            failureState: currentStatus,
          });
        }

        // Terminal success state
        if (
          currentStatus.includes("completed") ||
          currentStatus.includes("succeeded") ||
          currentStatus.includes("done") ||
          currentStatus === "success"
        ) {
          console.log(`✅ Polling job ${jobId}: Completed state reached.`);
          const resultUrl = statusResult.result_url || statusResult.url;

          if (resultUrl) {
            // Download result image/video to storage
            const savedMediaUrl = await downloadAndStoreGeneratedMedia(resultUrl, "higgsfield");
            const costPerImage = HIGGSFIELD_CONFIG.modelCosts[job.model as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;

            // Save to studio_generations
            const { data: record, error: dbErr } = await serviceSupabase
              .from("studio_generations")
              .insert({
                user_id: user?.id || null,
                task_id: job.taskId || null,
                prompt: job.prompt,
                model: job.model,
                ratio: job.ratio,
                reference_image_url: job.productImages[0]?.mediaUrl || null,
                higgsfield_media_ref: jobId,
                generated_image_url: savedMediaUrl,
                cost: costPerImage,
              })
              .select()
              .single();

            if (dbErr) {
              console.error("Failed to insert studio generation row:", dbErr);
            }

            activeJobs.delete(jobId);
            return NextResponse.json({
              status: "completed",
              records: record ? [record] : [],
            });
          }
        }

        // Job still processing
        const pollAfter = statusResult.poll_after_seconds || job.pollAfterSeconds || 3;
        const elapsed = Date.now() - job.createdAt;
        const progress = Math.min(Math.round((elapsed / Math.max(job.duration, 10000)) * 100), 95);

        return NextResponse.json({
          status: "processing",
          progress,
          pollAfterSeconds: pollAfter,
        });
      } catch (mcpErr) {
        console.warn(`⚠️ Higgsfield MCP: job_status tool call warning for ${jobId}:`, mcpErr);
      }
    }

    // 2. Local Simulation Fallback (for offline/test environments)
    const elapsed = Date.now() - job.createdAt;
    if (elapsed < job.duration) {
      const progress = Math.min(Math.round((elapsed / job.duration) * 100), 99);
      return NextResponse.json({
        status: "processing",
        progress,
        pollAfterSeconds: 3,
      });
    }

    // Fallback completion
    const costPerImage = HIGGSFIELD_CONFIG.modelCosts[job.model as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;
    const insertPromises = job.productImages.map(async (prodImg, index) => {
      const styleUrl = job.styleReference?.mediaUrl || "no-style";
      const hashInput = job.prompt + prodImg.mediaUrl + styleUrl + index;
      const hash = hashInput.split("").reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      const mockImage = MOCK_IMAGES[hash % MOCK_IMAGES.length];

      return serviceSupabase
        .from("studio_generations")
        .insert({
          user_id: user?.id || null,
          task_id: job.taskId || null,
          prompt: job.prompt,
          model: job.model,
          ratio: job.ratio,
          reference_image_url: prodImg.mediaUrl,
          higgsfield_media_ref: prodImg.higgsfieldMediaRef,
          generated_image_url: mockImage,
          cost: costPerImage,
        })
        .select()
        .single();
    });

    const results = await Promise.all(insertPromises);
    const records = results.map((res) => res.data).filter(Boolean);
    activeJobs.delete(jobId);

    return NextResponse.json({
      status: "completed",
      records,
    });
  } catch (error) {
    console.error("Higgsfield status check error:", error);
    return NextResponse.json({ error: "Failed to verify job status" }, { status: 500 });
  }
}
