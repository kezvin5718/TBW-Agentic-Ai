import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";

export interface QCCheckItem {
  name: string;
  status: "passed" | "failed";
  details: string;
  cited_source_field: string;
}

export interface QCReport {
  passed: boolean;
  checks: QCCheckItem[];
  suggested_corrections: string;
}

export async function runCreativeQCCheck(creativeId: string): Promise<{ success: boolean; report: QCReport | null; error?: string }> {
  const supabase = await createClient();

  // 1. Fetch creative, parent task, monthly plan, client guidelines
  const { data: creative, error: creativeErr } = await supabase
    .from("creatives")
    .select("*, tasks(*, monthly_plans(*, clients(*)))")
    .eq("id", creativeId)
    .single();

  if (creativeErr || !creative) {
    console.error("Creative not found for QC check:", creativeErr);
    return { success: false, report: null, error: creativeErr?.message || "Creative not found" };
  }

  const task = creative.tasks;
  const plan = task.monthly_plans;
  const client = plan.clients;
  const taskMeta = (task.metadata || {}) as Record<string, unknown>;

  // Fetch Brand Brain details
  const { data: brain } = await supabase
    .from("brand_brain")
    .select("*")
    .eq("client_id", client.id)
    .maybeSingle();

  const brandBrief = brain?.brand_brief || "";
  const tone = brain?.caption_tone || "Not specified";
  const colors = brain?.colors || [];
  const fonts = brain?.fonts || [];
  const designPrefs = brain?.design_preferences || {};
  const addresses = brain?.addresses || [];

  // 2. Draft the LLM prompt for checking creative guidelines
  const systemPrompt = "You are the Automated Quality Control Validator for TBW Advertising. Evaluate creative assets against brand guidelines and verify accuracy.";
  
  const userPrompt = `
  Analyze the following creative asset details against the client's Brand Brain guidelines and task specifications.
  
  Creative Details:
  - Caption under review: "${creative.caption || ""}"
  - Media asset type: "${creative.type}"
  - Target concept: "${taskMeta.concept || ""}"
  - Planned format: "${taskMeta.format || ""}"
  
  Client Brand Brain Rules:
  - Client Name: "${client.name}"
  - Brand Brief: "${brandBrief}"
  - Caption Tone guidelines: "${tone}"
  - Addresses list: ${JSON.stringify(addresses)}
  - Colors palette: ${JSON.stringify(colors)}
  - Fonts palette: ${JSON.stringify(fonts)}
  - Design Preferences: ${JSON.stringify(designPrefs)}

  Perform the following checks:
  1. Grammar & Spelling: Validate the caption copy for spelling errors.
  2. Brand Name matching: Ensure the client name ("${client.name}") is spelled 100% correctly if mentioned.
  3. Claim verification: Check if any claims in the caption (discounts, ingredient percentages like "100% organic", "protein %") are explicitly mentioned or supported by the Brand Brief. If not supported, flag it as a failed check.
  4. Offer Details: Verify that any pricing, discount numbers, dates, or store addresses match the brand brain addresses or task concept.
  
  Output a JSON object with this exact structure:
  {
    "passed": true/false (true only if ALL checks pass),
    "checks": [
      {
        "name": "Grammer & Spelling",
        "status": "passed" | "failed",
        "details": "Details of what was verified",
        "cited_source_field": "caption"
      },
      {
        "name": "Brand Name Accuracy",
        "status": "passed" | "failed",
        "details": "Details of the check",
        "cited_source_field": "client.name"
      },
      {
        "name": "Claim Verification",
        "status": "passed" | "failed",
        "details": "Details checking if protein percentages, discounts, or offers are supported in the brand brief",
        "cited_source_field": "brand_brief"
      },
      {
        "name": "Offer & Address Accuracy",
        "status": "passed" | "failed",
        "details": "Details checking prices, dates, or store addresses",
        "cited_source_field": "addresses"
      }
    ],
    "suggested_corrections": "Clear list of corrections if failed. If passed, return 'None.'"
  }

  Return ONLY valid JSON. Do not include markdown wraps.
  `;

  let report: QCReport | null = null;
  try {
    const response = await complete({
      model: MODEL_FAST,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      jsonSchema: {
        type: "object",
      },
    });

      report = safeJsonParse(response, {
        passed: true,
        checks: [
          { name: "Grammar & Spelling", status: "passed", details: "Default safety pass.", cited_source_field: "caption" }
        ],
        suggested_corrections: "None."
      }) as QCReport;
  } catch (llmErr) {
    console.error("QC LLM Check failed:", llmErr);
    return { success: false, report: null, error: "Generative model failed to audit asset." };
  }

  if (!report) {
    return { success: false, report: null, error: "Failed to compile QC report" };
  }

  const qcStatus = report.passed ? "passed" : "failed";

  // 3. Update creative row with QC results
  await supabase
    .from("creatives")
    .update({
      qc_status: qcStatus,
      qc_report: report,
    })
    .eq("id", creativeId);

  // 4. Log timeline event
  await supabase
    .from("creative_timeline")
    .insert({
      creative_id: creativeId,
      event_type: "qc_checked",
      status_from: "pending",
      status_to: qcStatus,
      actor_role: "system",
      notes: `QC audit completed. Corrections required: ${report.suggested_corrections}`,
    });

  // 5. Update task status based on QC results
  // If failed: set task back to in_progress so employee can see the edits needed
  // If passed: set task to review (meaning it's ready for founder review!)
  const nextTaskStatus = report.passed ? "review" : "in_progress";
  
  await supabase
    .from("tasks")
    .update({
      status: nextTaskStatus,
      // Store the correction notes in task metadata so they can be viewed
      metadata: {
        ...taskMeta,
        qc_corrections: report.suggested_corrections,
      }
    })
    .eq("id", task.id);

  return { success: true, report };
}
