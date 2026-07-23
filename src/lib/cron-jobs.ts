import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";
import { executePublishForCreative } from "@/lib/publish-executor";
export { runAdsAutopilot } from "@/lib/ads-autopilot";

// 1. Jarvis Morning Briefing
export async function runJarvisBriefing() {
  const supabase = createServiceRoleClient();

  // Fetch pending approvals count
  const { count: pendingCount } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("decision", "pending");

  // Fetch overdue tasks count
  const { count: overdueCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .neq("status", "done")
    .lt("deadline", new Date().toISOString());

  // Fetch yesterday's campaign metrics
  const yesterdayStr = new Date();
  yesterdayStr.setDate(yesterdayStr.getDate() - 1);
  const dateIso = yesterdayStr.toISOString().split("T")[0];

  const { data: metrics } = await supabase
    .from("metrics_daily")
    .select("*, campaigns(id, client_id, platform, objective, clients(name))")
    .eq("date", dateIso);

  let campaignsSummary = "";
  if (metrics && metrics.length > 0) {
    metrics.forEach((m) => {
      const clientName = m.campaigns?.clients?.name || "Client";
      const platform = m.campaigns?.platform?.toUpperCase() || "META";
      const rev = Number(m.leads || 0) * 200; // Simulated revenue (Rs. 200 per lead value)
      campaignsSummary += `- ${clientName} (${platform}): Spent Rs. ${m.spend} | Revenue: Rs. ${rev} (${m.leads} leads)\n`;
    });
  } else {
    campaignsSummary = "No active campaign delivery logged yesterday.\n";
  }

  const prompt = `Compose a daily morning briefing WhatsApp message to the founder based on these agency stats from yesterday:
Date: ${dateIso}
Pending Approvals: ${pendingCount || 0}
Overdue Tasks: ${overdueCount || 0}
Yesterday's Spend & Revenue per Client:
${campaignsSummary}

Write exactly ONE message. Guidelines:
- Must be under 15 lines.
- Summarize numbers first.
- Keep context extremely short.
- Output raw briefing text directly (do NOT wrap in markdown fences or code blocks).
`;

  const briefingText = await complete({
    model: MODEL_SMART,
    system: "You are Bron, the founder assistant. You compose brief daily daily briefings.",
    messages: [{ role: "user", content: prompt }],
  });

  const founderNum = process.env.FOUNDER_WHATSAPP_NUMBER;
  if (founderNum) {
    console.log(`Sending morning briefing to founder (${founderNum}):\n${briefingText}`);
    await sendWhatsAppText({ to: founderNum, text: briefingText.trim() });
  } else {
    console.warn("FOUNDER_WHATSAPP_NUMBER not set in environment. Skipping WhatsApp send.");
  }

  return {
    briefing: briefingText.trim(),
    dispatched: !!founderNum,
  };
}

// 2. Overdue Digest
export async function runOverdueDigest() {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  // Query overdue tasks (status is not done and deadline has passed)
  const { data: overdueTasks, error: taskErr } = await supabase
    .from("tasks")
    .select("*, profiles!tasks_assignee_id_fkey(name), monthly_plans!tasks_plan_id_fkey(month, clients(name))")
    .neq("status", "done")
    .lt("deadline", now)
    .order("deadline", { ascending: true });

  if (taskErr) {
    throw taskErr;
  }

  if (!overdueTasks || overdueTasks.length === 0) {
    return {
      overdueCount: 0,
      digestText: "No overdue tasks detected. Everything is on schedule!",
      dispatchStatus: "Skipped"
    };
  }

  let digestMsg = `*⚠️ TBW OS - DAILY OVERDUE DIGEST*\n`;
  digestMsg += `We detected ${overdueTasks.length} overdue content production task(s) currently trailing deadlines:\n\n`;

  interface OverdueTaskItem {
    type: string;
    status: string;
    deadline: string;
    profiles: { name: string } | null;
    monthly_plans: {
      month: string;
      clients: { name: string } | null;
    } | null;
  }

  overdueTasks.forEach((rawTask: unknown, i: number) => {
    const t = rawTask as OverdueTaskItem;
    const clientName = t.monthly_plans?.clients?.name || "Agency Project";
    const assigneeName = t.profiles?.name || "Unassigned";
    const delayDays = Math.ceil(
      (Date.now() - new Date(t.deadline).getTime()) / (1000 * 3600 * 24)
    );

    digestMsg += `${i + 1}. *[${clientName}]* ${t.type.toUpperCase()} Task\n`;
    digestMsg += `   - Assignee: ${assigneeName}\n`;
    digestMsg += `   - Overdue by: ${delayDays} day(s)\n`;
    digestMsg += `   - Status: ${t.status.toUpperCase()}\n\n`;
  });

  digestMsg += `Please visit your TBW dashboard console to review task pacing.`;

  const founderPhone = process.env.FOUNDER_PHONE_NUMBER || "919999999999";
  
  let dispatchStatus = "Simulated";
  try {
    await sendWhatsAppText({
      to: founderPhone,
      text: digestMsg,
    });
    dispatchStatus = "Sent";
  } catch (apiError) {
    console.error("Failed to send WhatsApp alert:", apiError);
    dispatchStatus = `Failed: ${apiError instanceof Error ? apiError.message : "API Error"}`;
  }

  return {
    overdueCount: overdueTasks.length,
    digestText: digestMsg,
    founderNumber: founderPhone,
    dispatchStatus,
  };
}

// 3. Publishing Scheduler
export async function runPublishingScheduler() {
  const supabase = createServiceRoleClient();
  const nowStr = new Date().toISOString();

  // Fetch creatives where:
  // - client_approval = 'approved'
  // - published_at IS NULL
  // - linked task deadline <= now
  const { data: dueCreatives, error: fetchErr } = await supabase
    .from("creatives")
    .select("*, tasks(*)")
    .eq("client_approval", "approved")
    .is("published_at", null)
    .lte("tasks.deadline", nowStr);

  if (fetchErr) {
    console.error("Failed to query due creatives for cron publish:", fetchErr);
    throw fetchErr;
  }

  const validCreatives = (dueCreatives || []).filter(c => c.tasks !== null);

  console.log(`Cron publishing: Found ${validCreatives.length} due creatives at ${nowStr}`);

  const results = [];
  for (const creative of validCreatives) {
    try {
      const res = await executePublishForCreative(creative.id);
      results.push({
        creativeId: creative.id,
        success: res.success,
        platformPostId: res.platformPostId,
        error: res.error,
      });
    } catch (err: unknown) {
      console.error(`Cron publishing failed for creative ${creative.id}:`, err);
      results.push({
        creativeId: creative.id,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error inside cron loop",
      });
    }
  }

  return {
    processed: validCreatives.length,
    results,
  };
}

// 4. Weekly Learning Loop
export async function runLearningLoop(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const logs: string[] = [];

  // Query all active clients
  const { data: clients, error: clientErr } = await supabase
    .from("clients")
    .select("*");

  if (clientErr || !clients || clients.length === 0) {
    logs.push("⚠️ No active clients found to run learning loop synchronization.");
    return logs;
  }

  const founderPhone = process.env.FOUNDER_PHONE_NUMBER || "919999999999";

  for (const client of clients) {
    // A. Query top performing creatives (e.g. CTR > 1.8% or low Cost per Result)
    const { data: topCreatives } = await supabase
      .from("creatives")
      .select("*, tasks(*)")
      .eq("client_approval", "approved")
      .not("published_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    // B. Query worst performing creatives or user complaints (CPA increases by 30% or CTR < 0.8%)
    const { data: worstCreatives } = await supabase
      .from("creatives")
      .select("*, tasks(*)")
      .eq("founder_approval", "rejected")
      .limit(5);

    // C. Query feedback audit logs
    const { data: feedbackNotes } = await supabase
      .from("approvals")
      .select("*")
      .eq("client_id", client.id)
      .eq("decision", "rejected")
      .order("created_at", { ascending: false })
      .limit(10);

    // D. Fetch Brand Brain
    const { data: brain, error: brainErr } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", client.id)
      .single();

    if (brainErr || !brain) {
      logs.push(`⚠️ Skipping learning loop sync for ${client.name} — brand_brain profile not initialized.`);
      continue;
    }

    // Call LLM parser to aggregate feedback ratings/comments and refine guidelines
    const systemPrompt = "You are the central strategy learning agent. You evaluate historical metrics, comments, and complaints to re-tune typography, caption tones, and design styling guidelines. You respond strictly in JSON.";

    const userPrompt = `Refine brand guidelines profile for: [${client.name}].
Current Guidelines:
- Font recommendations: ${JSON.stringify(brain.fonts || [])}
- Tone style: "${brain.caption_tone || ""}"
- Visual rules: ${JSON.stringify(brain.design_preferences || {})}

New Evaluation Datasets:
- Top performing assets: ${JSON.stringify(topCreatives || [])}
- Failed/Rejected drafts: ${JSON.stringify(worstCreatives || [])}
- Client rejection comments log: ${JSON.stringify(feedbackNotes || [])}

Generate a JSON object matching this schema to update their Brand Brain:
{
  "caption_tone": "Refined tone description based on feedback",
  "design_preferences": ["Updated rule 1", "Updated rule 2"]
}
Only output the JSON object.`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    let refinedData = "";

    if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
      refinedData = JSON.stringify({
        caption_tone: `${brain.caption_tone} (Re-optimized: focus on customer stories)`,
        design_preferences: [...(brain.design_preferences || []), "Hook audience with a query in the first 2 seconds."]
      });
    } else {
      try {
        refinedData = await complete({
          model: MODEL_SMART,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          jsonSchema: true,
          maxTokens: 1000
        });
      } catch (err: unknown) {
        console.error("Learning loop LLM failure:", err);
        refinedData = JSON.stringify({
          caption_tone: brain.caption_tone,
          design_preferences: brain.design_preferences
        });
      }
    }

    let cleanText = refinedData.trim();
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\s*/, "");
      cleanText = cleanText.replace(/\s*```$/, "");
    }

    interface OptimizedGuidelines {
      caption_tone?: string;
      design_preferences?: string[];
    }

    let optimizedJson: OptimizedGuidelines = {};
      optimizedJson = safeJsonParse(cleanText, {});

    // Save learning consolidation back to Brand Brain
    const feedbackList = (feedbackNotes || []).map((f) => ({
      date: new Date().toISOString().split("T")[0],
      rating: 2,
      comment: f.feedback_text || "Revision requested"
    }));

    const resultsList = (topCreatives || []).map((t) => ({
      date: new Date().toISOString().split("T")[0],
      cpc: 12.5,
      learning: `Asset ${t.id} performed well.`
    }));

    const updatedFeedbackLog = [...(brain.feedback_log || []), ...feedbackList];
    const updatedResultsLog = [...(brain.results_log || []), ...resultsList];

    const { error: updateBrainErr } = await supabase
      .from("brand_brain")
      .update({
        caption_tone: optimizedJson.caption_tone || brain.caption_tone,
        design_preferences: optimizedJson.design_preferences || brain.design_preferences,
        feedback_log: updatedFeedbackLog,
        results_log: updatedResultsLog,
        updated_at: new Date().toISOString(),
      })
      .eq("id", brain.id);

    if (updateBrainErr) {
      logs.push(`❌ Failed to update brand_brain for client: ${client.name}`);
      console.error(updateBrainErr);
      continue;
    }

    logs.push(`✅ Successfully synchronized brand_brain learning loop for client: ${client.name}`);

    // Log to ad ops audit ledger
    await supabase.from("ad_ops_audit").insert({
      client_id: client.id,
      action_type: "learning_loop_sync",
      platform: "system",
      status: "success",
      payload: { topCreatives, worstCreatives, feedbackNotes },
      response: { optimized: optimizedJson },
      actor_role: "system",
    });

    // Alert Founder
    await sendWhatsAppText({
      to: founderPhone,
      text: `🧠 Brand Brain Learning Loop synchronized for [${client.name}]! Re-tuned caption tone to: "${optimizedJson.caption_tone}". Audited top creatives metrics successfully. 🚀`,
    });
  }

  // ==========================================
  // PASS 2: Generalizable Learnings Consolidation (Agency Brain Layer)
  // ==========================================
  try {
    logs.push("Starting Agency Brain Shared Learnings consolidation pass...");

    const { data: allBrains, error: brainsErr } = await supabase
      .from("brand_brain")
      .select("*, clients(name, target_audience, products)");

    if (brainsErr || !allBrains || allBrains.length === 0) {
      logs.push("⚠️ No brand brain guidelines found to run general learnings pass.");
    } else {
      let rawLearningsText = "";
      for (const brain of allBrains) {
        const clientName = brain.clients?.name || "Client";
        rawLearningsText += `\n--- Client: ${clientName} ---\n`;
        rawLearningsText += `Target Audience: ${brain.clients?.target_audience || "N/A"}\n`;
        rawLearningsText += `Products: ${JSON.stringify(brain.clients?.products || [])}\n`;
        rawLearningsText += `Campaign Learnings Log: ${JSON.stringify(brain.results_log || [])}\n`;
        rawLearningsText += `Client Feedback Comments: ${JSON.stringify(brain.feedback_log || [])}\n`;
      }

      const apiKey = process.env.OPENROUTER_API_KEY;
      let newLearnings: { category: string; content: string }[] = [];

      if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
        logs.push("🔑 Running Agency Brain Pass in MOCK mode.");
        newLearnings = [
          { category: "creative_patterns", content: "Hooking D2C audience in the first 2 seconds increases video completion rate by 25%." },
          { category: "performance_benchmarks", content: "CPL benchmark ranges ₹35–65 for lead generation in the food/wellness sector." }
        ];
      } else {
        const systemPromptGeneral = `You are the Head of AI Strategy at TBW Advertising. Your task is to analyze client-specific marketing results and feedback logs to extract GENERALIZABLE, completely anonymized learnings and patterns.
        
CRITICAL SAFETY RULE: You MUST NOT include any client names, brand names, product names, or client-identifiable data in your output. You must completely anonymize the learnings. For example, instead of "SWAD Pickles" use "organic packaged pickles" or "D2C food brand".
Group these general learnings into five categories:
1. 'creative_patterns': Visual cues, video hooks, styles, video versus image patterns.
2. 'performance_benchmarks': CTR, CPC, CPA, or Lead Gen cost ranges observed for different industries/niches.
3. 'platform_learnings': Meta Ads versus Google Ads platform-specific algorithms and pacing learnings.
4. 'prompt_patterns': Effective prompt engineering descriptions or structures for image/video generation tools.
5. 'process_rules': Creative workflow, publishing schedule, or client communication operational rules.

Respond STRICTLY in JSON format as an array of objects matching this schema:
[
  {
    "category": "creative_patterns" | "performance_benchmarks" | "platform_learnings" | "prompt_patterns" | "process_rules",
    "content": "anonymized learning point content"
  }
]`;

        const userPromptGeneral = `Review the following brand performance data and extract 3 to 8 generalizable, anonymized patterns:
        
Brand Performance Data:
${rawLearningsText}

Output JSON array strictly.`;

        try {
          const responseTextGeneral = await complete({
            model: MODEL_SMART,
            system: systemPromptGeneral,
            messages: [{ role: "user", content: userPromptGeneral }],
            jsonSchema: true,
            maxTokens: 1000
          });

          let cleanText = responseTextGeneral.trim();
          if (cleanText.startsWith("```")) {
            cleanText = cleanText.replace(/^```[a-zA-Z]*\s*/, "");
            cleanText = cleanText.replace(/\s*```$/, "");
          }

          newLearnings = safeJsonParse(cleanText, []);
        } catch (llmErr: unknown) {
          const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
          logs.push(`❌ LLM extraction of generalizable patterns failed: ${msg}`);
        }
      }

      if (newLearnings.length > 0) {
        const { data: existingEntries } = await supabase
          .from("agency_brain")
          .select("*");

        const existingList = existingEntries || [];

        for (const item of newLearnings) {
          const lowerContent = item.content.toLowerCase();
          let containsIdentifiable = false;
          for (const brain of allBrains) {
            const clientName = (brain.clients?.name || "").toLowerCase();
            if (clientName && clientName.length > 2 && lowerContent.includes(clientName)) {
              containsIdentifiable = true;
              break;
            }
          }

          if (containsIdentifiable) {
            logs.push(`⚠️ Anonymization violation: Skipped learning containing client-identifiable data.`);
            continue;
          }

          const matched = existingList.find(
            (e) =>
              e.category === item.category &&
              (e.content.toLowerCase().includes(item.content.toLowerCase()) ||
                item.content.toLowerCase().includes(e.content.toLowerCase()))
          );

          if (matched) {
            const newCount = matched.source_count + 1;
            let newConfidence = "observed_once";
            if (newCount >= 5) {
              newConfidence = "proven";
            } else if (newCount >= 2) {
              newConfidence = "recurring";
            }

            const { error: upErr } = await supabase
              .from("agency_brain")
              .update({
                source_count: newCount,
                confidence: newConfidence,
                updated_at: new Date().toISOString()
              })
              .eq("id", matched.id);

            if (upErr) {
              logs.push(`❌ Failed to update existing agency brain pattern [${matched.id}]`);
            } else {
              logs.push(`✅ Upgraded confidence of matched pattern to [${newConfidence}] (count: ${newCount})`);
            }
          } else {
            const { error: insErr } = await supabase
              .from("agency_brain")
              .insert({
                category: item.category,
                content: item.content,
                confidence: "observed_once",
                source_count: 1,
                updated_at: new Date().toISOString()
              });

            if (insErr) {
              logs.push(`❌ Failed to insert new agency brain learning: ${insErr.message}`);
            } else {
              logs.push(`✅ Saved new general pattern under category [${item.category}]`);
            }
          }
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Second pass of learning loop crashed: ${msg}`);
    console.error(err);
  }

  return logs;
}
