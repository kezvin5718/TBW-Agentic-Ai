import { NextResponse } from "next/server";
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
    addLog("🚀 Starting Automated Higgsfield MCP End-to-End Test (Dual Test: Text-Only & Reference Image)...\n");

    const creds = await getHiggsfieldCredentials();
    if (!creds || creds.status !== "connected") {
      addLog("❌ Higgsfield is not connected.");
      return NextResponse.json({ success: false, error: "Higgsfield not connected", logs }, { status: 400 });
    }

    // Step 1: Discover Pro Model ID
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
    addLog(`🎯 Selected Pro Model ID: '${proModelId}'\n`);

    // ==========================================
    // CASE (a): TEXT-ONLY PROMPT (NO MEDIAS KEY)
    // ==========================================
    addLog("--- TEST CASE (a): TEXT-ONLY PROMPT (NO MEDIAS KEY ATTACHED) ---");
    const textOnlyParams: Record<string, unknown> = {
      model: proModelId,
      prompt: "A modern high-tech AI advertising studio billboard with vibrant indigo glow, 8k render",
      aspect_ratio: "16:9",
    };
    addLog(`⚙️ [Request Payload (a)]:\n${JSON.stringify({ params: textOnlyParams }, null, 2)}`);

    const submitResA = await executeHiggsfieldGenerationTool(creds, "generate_image", textOnlyParams);
    addLog(`⚙️ [RAW Submission Response (a)]:\n${JSON.stringify(submitResA, null, 2)}`);

    const parsedSubmitA = parseMCPToolResponse(submitResA);
    const jobIdA = parsedSubmitA.jobId || parsedSubmitA.id || parsedSubmitA.job_id;

    if (!jobIdA) {
      addLog("❌ Case (a) submission failed to return a job ID.");
      return NextResponse.json({ success: false, error: "Case (a) submission failed", logs }, { status: 500 });
    }
    addLog(`✅ Case (a) Job submitted successfully! Job ID: '${jobIdA}'`);

    // Poll Case (a)
    let completedA = false;
    let attemptsA = 0;
    let urlA: string | undefined = undefined;

    while (!completedA && attemptsA < 20) {
      attemptsA++;
      addLog(`🔄 [Poll (a) #${attemptsA}]: Querying job_status with { jobId: "${jobIdA}" }...`);
      const statusRes = await pollHiggsfieldJobStatus(creds, jobIdA);
      const st = (statusRes.status || "processing").toLowerCase();
      urlA = statusRes.result_url || statusRes.url || (statusRes.result_urls && statusRes.result_urls[0]);

      if (st.includes("completed") || st.includes("succeeded") || urlA) {
        completedA = true;
        addLog(`🎉 CASE (a) COMPLETED SUCCESSFULLY!`);
        addLog(`📍 Result URL (a): ${urlA || "Found in payload"}\n`);
        break;
      } else if (st.includes("fail") || st.includes("error") || st.includes("nsfw")) {
        addLog(`❌ Case (a) job failed: ${statusRes.error || "Failed"}\n`);
        break;
      }
      await new Promise((r) => setTimeout(r, (statusRes.poll_after_seconds || 3) * 1000));
    }

    // ==========================================
    // CASE (b): ONE REFERENCE IMAGE WITH ROLE "IMAGE"
    // ==========================================
    addLog("--- TEST CASE (b): ONE REFERENCE IMAGE (ROLE: 'IMAGE') ---");
    // Ensure media import reference image
    const dummyRefId = `media_id_ref_test_${Date.now()}`;
    const formattedMediasB = formatHiggsfieldMedias([dummyRefId], null, []);

    const imageRefParams: Record<string, unknown> = {
      model: proModelId,
      prompt: "Photorealistic luxury product showcase featuring reference image 1, studio lighting",
      aspect_ratio: "16:9",
      medias: formattedMediasB,
    };
    addLog(`⚙️ [Request Payload (b)]:\n${JSON.stringify({ params: imageRefParams }, null, 2)}`);

    const submitResB = await executeHiggsfieldGenerationTool(creds, "generate_image", imageRefParams);
    addLog(`⚙️ [RAW Submission Response (b)]:\n${JSON.stringify(submitResB, null, 2)}`);

    const parsedSubmitB = parseMCPToolResponse(submitResB);
    const jobIdB = parsedSubmitB.jobId || parsedSubmitB.id || parsedSubmitB.job_id;

    if (!jobIdB) {
      addLog("❌ Case (b) submission failed to return a job ID.");
      return NextResponse.json({ success: false, error: "Case (b) submission failed", logs }, { status: 500 });
    }
    addLog(`✅ Case (b) Job submitted successfully! Job ID: '${jobIdB}'`);

    // Poll Case (b)
    let completedB = false;
    let attemptsB = 0;
    let urlB: string | undefined = undefined;

    while (!completedB && attemptsB < 20) {
      attemptsB++;
      addLog(`🔄 [Poll (b) #${attemptsB}]: Querying job_status with { jobId: "${jobIdB}" }...`);
      const statusRes = await pollHiggsfieldJobStatus(creds, jobIdB);
      const st = (statusRes.status || "processing").toLowerCase();
      urlB = statusRes.result_url || statusRes.url || (statusRes.result_urls && statusRes.result_urls[0]);

      if (st.includes("completed") || st.includes("succeeded") || urlB) {
        completedB = true;
        addLog(`🎉 CASE (b) COMPLETED SUCCESSFULLY!`);
        addLog(`📍 Result URL (b): ${urlB || "Found in payload"}\n`);
        break;
      } else if (st.includes("fail") || st.includes("error") || st.includes("nsfw")) {
        addLog(`❌ Case (b) job failed: ${statusRes.error || "Failed"}\n`);
        break;
      }
      await new Promise((r) => setTimeout(r, (statusRes.poll_after_seconds || 3) * 1000));
    }

    addLog("🏁 DUAL END-TO-END TEST SUITE COMPLETED!");
    return NextResponse.json({
      success: completedA && completedB,
      caseA: { jobId: jobIdA, resultUrl: urlA, completed: completedA },
      caseB: { jobId: jobIdB, resultUrl: urlB, completed: completedB },
      logs,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addLog(`❌ End-to-End Test Suite Error: ${msg}`);
    return NextResponse.json({ success: false, error: msg, logs }, { status: 500 });
  }
}
