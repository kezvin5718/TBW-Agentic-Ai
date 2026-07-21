import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getHiggsfieldCredentials,
  executeHiggsfieldMCPTool,
  executeHiggsfieldGenerationTool,
  parseMCPToolResponse,
  pollHiggsfieldJobStatus,
  formatHiggsfieldMedias,
} from "@/lib/higgsfield-mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  const logs: string[] = [];
  const addLog = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    addLog("🚀 Starting Automated Higgsfield MCP End-to-End Test...");

    const creds = await getHiggsfieldCredentials();
    if (!creds || creds.status !== "connected") {
      addLog("❌ Higgsfield is not connected.");
      return NextResponse.json({ success: false, error: "Higgsfield not connected", logs }, { status: 400 });
    }

    // Step 1: Call models_explore (action: 'list')
    addLog("⚙️ [Step 1]: Invoking models_explore (action: 'list')...");
    let listRaw: unknown;
    try {
      listRaw = await executeHiggsfieldMCPTool(creds, "models_explore", { action: "list" });
    } catch {
      listRaw = await executeHiggsfieldMCPTool(creds, "models_explore", { params: { action: "list" } });
    }

    addLog(`⚙️ [RAW Response - models_explore list]:\n${JSON.stringify(listRaw, null, 2)}`);

    const parsedList = parseMCPToolResponse(listRaw);
    let proModelId = "nano_banana_pro";

    if (parsedList.items && Array.isArray(parsedList.items)) {
      const foundPro = parsedList.items.find((m) =>
        String(m.id || m.model || "").includes("pro")
      );
      if (foundPro) {
        proModelId = (foundPro.id || foundPro.model) as string;
      } else if (parsedList.items[0]) {
        proModelId = (parsedList.items[0].id || parsedList.items[0].model || proModelId) as string;
      }
    }

    addLog(`🎯 [Step 2]: Selected Pro Model ID: '${proModelId}'`);

    // Step 2: Call models_explore (action: 'get', model: proModelId)
    addLog(`⚙️ [Step 3]: Invoking models_explore (action: 'get', model: '${proModelId}')...`);
    let getRaw: unknown;
    try {
      getRaw = await executeHiggsfieldMCPTool(creds, "models_explore", { action: "get", model: proModelId });
    } catch {
      getRaw = await executeHiggsfieldMCPTool(creds, "models_explore", { params: { action: "get", model: proModelId } });
    }
    addLog(`⚙️ [RAW Response - models_explore get for ${proModelId}]:\n${JSON.stringify(getRaw, null, 2)}`);

    // Step 3: Call generate_image text-only prompt with NO medias key
    addLog(`🎨 [Step 4]: Submitting generate_image (Text-Only Prompt, NO medias key)...`);
    const promptText = "A futuristic AI creative ad production studio billboard, vibrant dark mode glassmorphic UI, 8k resolution";

    const formattedMedias = formatHiggsfieldMedias([], null, []);
    const genParams: Record<string, unknown> = {
      model: proModelId,
      prompt: promptText,
      aspect_ratio: "16:9",
    };
    if (formattedMedias && formattedMedias.length > 0) {
      genParams.medias = formattedMedias;
    }

    addLog(`⚙️ [Request Payload]:\n${JSON.stringify({ params: genParams }, null, 2)}`);

    const submitRes = await executeHiggsfieldGenerationTool(creds, "generate_image", genParams);
    addLog(`⚙️ [RAW Submission Response - generate_image]:\n${JSON.stringify(submitRes, null, 2)}`);

    const parsedSubmit = parseMCPToolResponse(submitRes);
    const jobId = parsedSubmit.jobId || parsedSubmit.id || parsedSubmit.job_id;

    if (!jobId) {
      addLog("❌ Failed to extract job ID from submission response!");
      return NextResponse.json({ success: false, error: "No job ID returned", logs }, { status: 500 });
    }

    addLog(`✅ Job submitted successfully! Job ID: '${jobId}'`);

    // Step 4: Poll job_status tool until completion
    addLog("⏱️ [Step 5]: Starting job_status polling loop...");
    let completed = false;
    let attempts = 0;
    let finalResultUrl: string | undefined = undefined;

    while (!completed && attempts < 20) {
      attempts++;
      addLog(`🔄 [Poll #${attempts}]: Querying job_status with { jobId: "${jobId}" }...`);
      const statusRes = await pollHiggsfieldJobStatus(creds, jobId);
      const st = (statusRes.status || "processing").toLowerCase();
      finalResultUrl = statusRes.result_url || statusRes.url || (statusRes.result_urls && statusRes.result_urls[0]);

      if (st.includes("completed") || st.includes("succeeded") || finalResultUrl) {
        completed = true;
        addLog(`🎉 JOB COMPLETED SUCCESSFULLY!`);
        addLog(`📍 Result URL: ${finalResultUrl || "Found in payload"}`);
        break;
      } else if (st.includes("fail") || st.includes("error") || st.includes("nsfw")) {
        addLog(`❌ Job failed with state '${st}': ${statusRes.error || "Failed"}`);
        break;
      }

      await new Promise((r) => setTimeout(r, (statusRes.poll_after_seconds || 3) * 1000));
    }

    return NextResponse.json({
      success: completed,
      jobId,
      resultUrl: finalResultUrl,
      logs,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addLog(`❌ End-to-End Test Error: ${msg}`);
    return NextResponse.json({ success: false, error: msg, logs }, { status: 500 });
  }
}
