import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activeJobs } from "../../generate/route";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";

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

    const elapsed = Date.now() - job.createdAt;

    if (elapsed < job.duration) {
      const progress = Math.min(Math.round((elapsed / job.duration) * 100), 99);
      return NextResponse.json({
        status: "processing",
        progress,
      });
    }

    // Job complete! Get database client & user session
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const costPerImage = HIGGSFIELD_CONFIG.modelCosts[job.model as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;

    // Create a completion record for each product image in the batch in order
    const insertPromises = job.productImages.map(async (prodImg, index) => {
      // Pick image based on prompt hash, product URL, and style ref URL to ensure variability
      const styleUrl = job.styleReference?.mediaUrl || "no-style";
      const hashInput = job.prompt + prodImg.mediaUrl + styleUrl + index;
      const hash = hashInput.split("").reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      const mockImage = MOCK_IMAGES[hash % MOCK_IMAGES.length];

      return supabase
        .from("studio_generations")
        .insert({
          user_id: user?.id || null,
          task_id: job.taskId || null,
          prompt: job.prompt,
          model: job.model,
          ratio: job.ratio,
          reference_image_url: prodImg.mediaUrl, // Product image is saved as the source reference URL
          higgsfield_media_ref: prodImg.higgsfieldMediaRef,
          generated_image_url: mockImage,
          cost: costPerImage,
        })
        .select()
        .single();
    });

    const results = await Promise.all(insertPromises);
    const dbErrors = results.filter((res) => res.error);

    if (dbErrors.length > 0) {
      console.error("Some product generations failed to persist:", dbErrors);
    }

    const records = results.map((res) => res.data).filter(Boolean);

    // Clean up job cache
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
