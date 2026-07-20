import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function GET(request: Request) {
  // Simple check for cron authorization (simulated key or Bearer)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const logs = await runLearningLoop();
    return NextResponse.json({
      success: true,
      message: "Weekly learning loop cron executed successfully",
      logs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Weekly learning loop cron failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal Learning Loop Cron Error",
      },
      { status: 550 }
    );
  }
}

// POST endpoint for manual trigger via dashboard workspace quick-action
export async function POST() {
  try {
    const logs = await runLearningLoop();
    return NextResponse.json({
      success: true,
      message: "Manual learning loop execution completed",
      logs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Manual Learning Loop trigger failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function runLearningLoop(): Promise<string[]> {
  const supabase = await createClient();
  const logs: string[] = [];

  // Get founder phone
  const { data: founderProfile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("role", "founder")
    .limit(1)
    .maybeSingle();
  const founderPhone = founderProfile?.phone || "9999999999";

  // Fetch all clients
  const { data: clients } = await supabase.from("clients").select("*");
  if (!clients || clients.length === 0) {
    return ["No active clients onboarded to run learning loop."];
  }

  for (const client of clients) {
    logs.push(`Processing learning loop optimization for client: ${client.name}`);

    // 1. Get client brand brain
    const { data: brain } = await supabase
      .from("brand_brain")
      .select("*")
      .eq("client_id", client.id)
      .limit(1)
      .maybeSingle();

    if (!brain) {
      logs.push(`⚠️ Brand brain not initialized for client: ${client.name}. Skipping.`);
      continue;
    }

    interface CreativePerformer {
      campaign_id: string;
      ctr: number;
      roas: number;
      spend: number;
    }

    // 2. Query campaigns and metrics daily to identify performance trends
    const { data: campaigns } = await supabase.from("campaigns").select("id").eq("client_id", client.id);
    const campaignIds = (campaigns || []).map((c) => c.id);

    let topCreatives: CreativePerformer[] = [];
    let worstCreatives: CreativePerformer[] = [];

    if (campaignIds.length > 0) {
      // Pick top/worst performer metrics from past 7 days
      const { data: metrics } = await supabase
        .from("metrics_daily")
        .select("*, campaigns(id)")
        .in("campaign_id", campaignIds)
        .order("created_at", { ascending: false })
        .limit(10);

      // Order simulated performances (let's assume we map results list to CTR representation)
      const sortedMetrics = (metrics || []).sort((a, b) => {
        const ctrA = Number((a.results as Record<string, unknown>)?.ctr_percentage || 0);
        const ctrB = Number((b.results as Record<string, unknown>)?.ctr_percentage || 0);
        return ctrB - ctrA;
      });

      topCreatives = sortedMetrics.slice(0, 3).map((m) => ({
        campaign_id: m.campaign_id,
        ctr: Number((m.results as Record<string, unknown>)?.ctr_percentage || 0),
        roas: Number((m.results as Record<string, unknown>)?.roas || 0),
        spend: Number(m.spend || 0),
      }));

      worstCreatives = sortedMetrics.slice(-2).map((m) => ({
        campaign_id: m.campaign_id,
        ctr: Number((m.results as Record<string, unknown>)?.ctr_percentage || 0),
        roas: Number((m.results as Record<string, unknown>)?.roas || 0),
        spend: Number(m.spend || 0),
      }));
    }

    // 3. Query client feedback approvals logs from past 7 days
    const { data: recentFeedback } = await supabase
      .from("approvals")
      .select("*")
      .eq("client_id", client.id)
      .eq("approver_role", "client")
      .eq("decision", "rejected")
      .limit(5);

    const feedbackNotes = (recentFeedback || []).map((f) => f.feedback_text).filter(Boolean);

    // 4. Feed back insights to Gemini and optimize brand_brain rules
    const systemPrompt = `You are an AI brand strategy consultant. Your goal is to refine the brand's creative rules, captions, design guidelines, and audience settings based on weekly feedback and metrics.`;
    const userPrompt = `
    Optimise Brand Brain parameters for "${client.name}".
    
    Current Parameters:
    - Caption Tone: "${brain.caption_tone || "playful"}"
    - Design Preferences: ${JSON.stringify(brain.design_preferences || ["minimalist"])}
    - Target Audience Focus: "${client.target_audience || "young adults"}"

    Weekly Learnings:
    - Best performing creatives metrics: ${JSON.stringify(topCreatives)}
    - Worst performing creatives metrics: ${JSON.stringify(worstCreatives)}
    - Client feedback/rejection comments this week: ${JSON.stringify(feedbackNotes)}

    Generate a revised JSON profile containing:
    {
      "caption_tone": "Refined descriptive adjectives for tone",
      "design_preferences": ["New list of styles representing guidelines and avoiding failed ones"],
      "audience_insights": "A summary of who was engaged best"
    }

    Respond ONLY with the JSON block. Do not write markdown blocks or text wrapper sentences.
    `;

    let optimizedJson: Record<string, unknown> = {};
    try {
      const responseText = await complete({
        model: MODEL_SMART,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      // Parse response text cleanly
      const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      optimizedJson = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error("Gemini failed to parse learning loop response:", parseErr);
      optimizedJson = {
        caption_tone: brain.caption_tone || "playful",
        design_preferences: brain.design_preferences || ["minimalist"],
        audience_insights: "Target general demographic.",
      };
    }

    // 5. Append to brand_brain logs and update fields
    const updatedFeedbackLog = [...((brain.feedback_log as Record<string, unknown>[]) || [])];
    feedbackNotes.forEach((note) => {
      updatedFeedbackLog.push({
        date: new Date().toISOString().split("T")[0],
        rating: 1,
        comment: note,
      });
    });

    const updatedResultsLog = [...((brain.results_log as Record<string, unknown>[]) || [])];
    topCreatives.forEach((c) => {
      updatedResultsLog.push({
        date: new Date().toISOString().split("T")[0],
        cpc: c.ctr > 0 ? Number((c.spend / (c.spend * c.ctr)).toFixed(2)) : 0,
        learning: `Campaign ID ${c.campaign_id} excelled with CTR ${c.ctr}% and ROAS ${c.roas}x. Keep hook short.`,
      });
    });

    const { error: updateBrainErr } = await supabase
      .from("brand_brain")
      .update({
        caption_tone: (optimizedJson.caption_tone as string) || brain.caption_tone,
        design_preferences: (optimizedJson.design_preferences as string[]) || brain.design_preferences,
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

          newLearnings = JSON.parse(cleanText);
        } catch (llmErr: any) {
          logs.push(`❌ LLM extraction of generalizable patterns failed: ${llmErr.message}`);
        }
      }

      if (newLearnings.length > 0) {
        const { data: existingEntries } = await supabase
          .from("agency_brain")
          .select("*");

        const existingList = existingEntries || [];

        for (const item of newLearnings) {
          // Strict scrub check to ensure no brand/client names leaked into content
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
  } catch (err: any) {
    logs.push(`❌ Second pass of learning loop crashed: ${err.message}`);
    console.error(err);
  }

  return logs;
}
