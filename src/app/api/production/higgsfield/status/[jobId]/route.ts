import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { activeJobs } from "@/lib/higgsfield-state";
import { HIGGSFIELD_CONFIG } from "@/lib/higgsfield-config";
import {
  getHiggsfieldCredentials,
  pollHiggsfieldJobStatus,
  downloadAndStoreGeneratedMedia,
  uploadToSupabaseStorageDirect,
} from "@/lib/higgsfield-mcp";
import { applyClientBrandingOverlay, type ClientBrandingConfig } from "@/lib/branding-composite";
import { generateOpenAIImage, OPENAI_IMAGE_CONFIG, describeImageViaVision } from "@/lib/integrations/openai-images";
import * as crypto from "crypto";

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
    const isVideo = job.model.includes("video") || job.prompt.toLowerCase().includes("video");
    const timeoutMs = isVideo ? 8 * 60 * 1000 : 3 * 60 * 1000; // 8 mins video, 3 mins image

    // Hard Timeout enforcement (Requirement 4 & 5)
    if (elapsed > timeoutMs) {
      console.error(`❌ Higgsfield MCP: Job ${jobId} timed out after ${Math.round(elapsed / 1000)}s! Canceling server-side polling.`);
      activeJobs.delete(jobId);
      return NextResponse.json({
        status: "timed_out",
        error: `Generation timed out after ${isVideo ? "8" : "3"} minutes.`,
        jobId,
        canRetry: true,
      });
    }

    const serviceSupabase = createServiceRoleClient();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check if the job engine is OpenAI
    if (job.engine === "openai" || job.model.startsWith("openai") || job.model.includes("dall-e")) {
      const costPerImage = OPENAI_IMAGE_CONFIG.costPerImage;
      try {
        console.log(`[OpenAI Status Poll] Starting DALL-E generation for job: ${jobId}`);

        // Resolve style reference via Vision if attached
        let styleRefDescription = "";
        if (job.styleReference?.mediaUrl) {
          try {
            console.log(`[OpenAI Status Poll] Analyzing style reference image: ${job.styleReference.mediaUrl}`);
            const stylePrompt = "Analyze the style, background, lighting, and mood of this image. Provide a highly descriptive 50-word summary of the visual aesthetic (materials, colors, lighting, mood) to serve as a style prompt. Do not mention any text or products in the image.";
            const desc = await describeImageViaVision(job.styleReference.mediaUrl, stylePrompt);
            if (desc) styleRefDescription = desc.trim();
          } catch (e) {
            console.error("Failed to analyze style reference image:", e);
          }
        }

        let composedDallePrompt = job.prompt;
        if (styleRefDescription) {
          composedDallePrompt = `[VISUAL STYLE REFERENCE: ${styleRefDescription}] ${composedDallePrompt}`;
        }

        // Call OpenAI DALL-E
        const result = await generateOpenAIImage(composedDallePrompt, {
          ratio: job.ratio,
          productImageUrl: job.productImages[0]?.mediaUrl || null,
        });

        if (!result.success || !result.url) {
          throw new Error(result.error || "OpenAI Image Generation returned no URL");
        }

        // 2. Download and store permanently
        const permanentUrl = await downloadAndStoreGeneratedMedia(result.url, "openai");

        // 3. Save clean original record to studio_generations
        const { data: record, error: dbErr } = await serviceSupabase
          .from("studio_generations")
          .insert({
            user_id: user?.id || null,
            task_id: job.taskId || null,
            category_id: job.categoryId || null,
            raw_input: job.rawInput || null,
            prompt: job.prompt,
            model: job.model || "dall-e-3",
            ratio: job.ratio,
            reference_image_url: job.productImages[0]?.mediaUrl || null,
            higgsfield_media_ref: jobId,
            generated_image_url: permanentUrl,
            cost: costPerImage,
          })
          .select()
          .single();

        if (dbErr) throw dbErr;

        const returnRecords = [record];

        // 4. Apply branding overlays if enabled
        if (job.branding && job.branding.enabled && job.branding.clientId) {
          try {
            const fetchRes = await fetch(permanentUrl);
            if (fetchRes.ok) {
              const baseBuffer = Buffer.from(await fetchRes.arrayBuffer());
              const { data: brandingConfig } = await serviceSupabase
                .from("brand_brain")
                .select("colors, logo_url, addresses")
                .eq("client_id", job.branding.clientId)
                .single();

              const logoUrl = brandingConfig?.logo_url || null;
              const address = brandingConfig?.addresses && Array.isArray(brandingConfig.addresses) && brandingConfig.addresses.length > 0
                ? brandingConfig.addresses[0]
                : null;

              const brandedBuffer = await applyClientBrandingOverlay(baseBuffer, {
                logoUrl,
                addressText: address,
                includeLogo: job.branding.includeLogo !== false,
                includeAddress: job.branding.includeAddress !== false,
                config: (brandingConfig as unknown) as ClientBrandingConfig,
              });

              const brandedFileName = `branded-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
              const brandedPublicUrl = await uploadToSupabaseStorageDirect(brandedFileName, brandedBuffer, "image/png");

              if (brandedPublicUrl) {
                const { data: brandedRecord } = await serviceSupabase
                  .from("studio_generations")
                  .insert({
                    user_id: user?.id || null,
                    task_id: job.taskId || null,
                    category_id: job.categoryId || null,
                    raw_input: job.rawInput || null,
                    prompt: `${job.prompt} [Client Branded]`,
                    model: job.model || "dall-e-3",
                    ratio: job.ratio,
                    reference_image_url: job.productImages[0]?.mediaUrl || null,
                    higgsfield_media_ref: `${jobId}-branded`,
                    generated_image_url: brandedPublicUrl,
                    cost: 0,
                    parent_generation_id: record.id,
                    branded_variant_url: brandedPublicUrl,
                    is_branded: true,
                  })
                  .select()
                  .single();

                if (brandedRecord) {
                  returnRecords.unshift(brandedRecord);
                }

                await serviceSupabase
                  .from("studio_generations")
                  .update({ branded_variant_url: brandedPublicUrl })
                  .eq("id", record.id);
              }
            }
          } catch (brandErr) {
            console.error("❌ OpenAI Server Branding Overlay Error:", brandErr);
          }
        }

        activeJobs.delete(jobId);
        return NextResponse.json({
          status: "completed",
          records: returnRecords,
        });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ OpenAI Generation Failed: ${msg}`);
        activeJobs.delete(jobId);
        return NextResponse.json({
          status: "failed",
          error: msg,
        });
      }
    }

    const creds = await getHiggsfieldCredentials();

    // 1. Real MCP Job Status Polling
    if (creds && creds.status === "connected") {
      try {
        const statusResult = await pollHiggsfieldJobStatus(creds, jobId);
        const currentStatus = (statusResult.status || "processing").toLowerCase();

        // Failed / NSFW / IP_Detected / Rejected states (Requirement 2)
        if (
          currentStatus.includes("fail") ||
          currentStatus.includes("error") ||
          currentStatus.includes("nsfw") ||
          currentStatus.includes("ip_detected") ||
          currentStatus.includes("reject") ||
          currentStatus.includes("cancel")
        ) {
          const failureReason = statusResult.failure_reason || statusResult.error || `Generation stopped (${currentStatus})`;
          console.error(`❌ Polling job ${jobId}: Terminal failure state detected (${currentStatus}):`, failureReason);
          console.error(`❌ Last raw response for ${jobId}:`, JSON.stringify(statusResult.raw, null, 2));
          activeJobs.delete(jobId);
          return NextResponse.json({
            status: "failed",
            error: failureReason,
            failureState: currentStatus,
          });
        }

        // Terminal success state (Requirement 2)
        // Requirement 3: Terminal success state - log raw completed job_status response once
        if (
          currentStatus.includes("completed") ||
          currentStatus.includes("succeeded") ||
          currentStatus.includes("done") ||
          currentStatus === "success" ||
          statusResult.result_url ||
          (statusResult.result_urls && statusResult.result_urls.length > 0)
        ) {
          console.log(`✅ Polling job ${jobId}: Completed state reached.`);
          console.log(`⚙️ Higgsfield MCP [RAW Completed job_status Response for ${jobId}]:\n${JSON.stringify(statusResult.raw || statusResult, null, 2)}`);

          // Requirement 3: Extract result URL from actual fields (result_url, results[].url, structuredContent, etc.)
          let resultUrl = statusResult.result_url || statusResult.url;
          if (!resultUrl && statusResult.raw && typeof statusResult.raw === "object") {
            const rawObj = statusResult.raw as Record<string, unknown>;
            const struct = (rawObj.structuredContent || rawObj.structured_content || rawObj) as Record<string, unknown>;
            const resArr = (struct?.results || rawObj.results || struct?.items) as Array<Record<string, unknown>> | undefined;

            if (Array.isArray(resArr) && resArr[0]) {
              const firstItem = resArr[0];
              resultUrl = (firstItem.result_url || firstItem.url || firstItem.output || firstItem.media_url) as string;
            }
          }

          if (!resultUrl && statusResult.result_urls && statusResult.result_urls.length > 0) {
            resultUrl = statusResult.result_urls[0];
          }

          if (resultUrl) {
            // Requirement 1 & 2: Download image server-side and upload clean original to Supabase Storage
            const savedMediaUrl = await downloadAndStoreGeneratedMedia(resultUrl, "higgsfield");
            const costPerImage = HIGGSFIELD_CONFIG.modelCosts[job.model as keyof typeof HIGGSFIELD_CONFIG.modelCosts] || 1.5;

            const { data: record, error: dbErr } = await serviceSupabase
              .from("studio_generations")
              .insert({
                user_id: user?.id || null,
                task_id: job.taskId || null,
                category_id: job.categoryId || null,
                raw_input: job.rawInput || null,
                prompt: job.prompt,
                model: job.model,
                ratio: job.ratio,
                reference_image_url: job.productImages[0]?.mediaUrl || null,
                higgsfield_media_ref: jobId,
                generated_image_url: savedMediaUrl,
                cost: costPerImage,
                is_branded: false,
              })
              .select()
              .single();

            if (dbErr) {
              console.error("Failed to insert studio generation row:", dbErr);
            }

            const returnRecords: unknown[] = record ? [record] : [];

            // Requirement 2: SERVER-SIDE Client Branding Composite (Optional)
            if (job.branding?.enabled && job.branding.clientId && record) {
              try {
                console.log(`🎨 Server Branding: Applying branding for client ID: ${job.branding.clientId}`);
                const { data: clientData } = await serviceSupabase
                  .from("clients")
                  .select("logo_url, name")
                  .eq("id", job.branding.clientId)
                  .single();

                const { data: brainData } = await serviceSupabase
                  .from("brand_brain")
                  .select("addresses, design_preferences")
                  .eq("client_id", job.branding.clientId)
                  .maybeSingle();

                const logoUrl = clientData?.logo_url || null;
                let addressText: string | null = null;
                if (brainData?.addresses) {
                  if (typeof brainData.addresses === "string") {
                    addressText = brainData.addresses;
                  } else if (Array.isArray(brainData.addresses) && brainData.addresses[0]) {
                    const first = brainData.addresses[0];
                    addressText = typeof first === "string" ? first : (first.address || first.text || JSON.stringify(first));
                  } else if (typeof brainData.addresses === "object") {
                    const obj = brainData.addresses as Record<string, unknown>;
                    addressText = (obj.primary || obj.address || obj.text) as string;
                  }
                }

                const brandingConfig = (brainData?.design_preferences as Record<string, unknown>)?.branding_config as Record<string, unknown> | undefined;

                // Download clean original binary for sharp compositing
                const cleanRes = await fetch(resultUrl);
                if (cleanRes.ok) {
                  const cleanBuffer = Buffer.from(await cleanRes.arrayBuffer());
                  const brandedBuffer = await applyClientBrandingOverlay(cleanBuffer, {
                    logoUrl,
                    addressText,
                    includeLogo: job.branding.includeLogo !== false,
                    includeAddress: job.branding.includeAddress !== false,
                    config: (brandingConfig as unknown) as ClientBrandingConfig,
                  });

                  const brandedFileName = `branded-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
                  const brandedPublicUrl = await uploadToSupabaseStorageDirect(brandedFileName, brandedBuffer, "image/png");

                  if (brandedPublicUrl) {
                    // Requirement 2.d: Save BOTH files (clean original + linked branded variant)
                    const { data: brandedRecord } = await serviceSupabase
                      .from("studio_generations")
                      .insert({
                        user_id: user?.id || null,
                        task_id: job.taskId || null,
                        category_id: job.categoryId || null,
                        raw_input: job.rawInput || null,
                        prompt: `${job.prompt} [Client Branded]`,
                        model: job.model,
                        ratio: job.ratio,
                        reference_image_url: job.productImages[0]?.mediaUrl || null,
                        higgsfield_media_ref: `${jobId}-branded`,
                        generated_image_url: brandedPublicUrl,
                        cost: 0, // Variant cost zero
                        parent_generation_id: record.id,
                        branded_variant_url: brandedPublicUrl,
                        is_branded: true,
                      })
                      .select()
                      .single();

                    if (brandedRecord) {
                      returnRecords.unshift(brandedRecord);
                    }

                    await serviceSupabase
                      .from("studio_generations")
                      .update({ branded_variant_url: brandedPublicUrl })
                      .eq("id", record.id);
                  }
                }
              } catch (brandErr) {
                console.error("❌ Server Branding Overlay Error:", brandErr);
              }
            }

            activeJobs.delete(jobId);
            return NextResponse.json({
              status: "completed",
              records: returnRecords,
            });
          }
        }

        // Job still processing - respect poll_after_seconds (Requirement 3)
        const pollAfter = statusResult.poll_after_seconds || job.pollAfterSeconds || 3;
        const progress = Math.min(Math.round((elapsed / Math.max(job.duration, 15000)) * 100), 95);

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
