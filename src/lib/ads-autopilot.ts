import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

interface AutopilotRuleSet {
  scale_condition: {
    min_roas: number;
    increase_amount: number;
    cap_budget: number;
  };
  trim_condition: {
    max_roas: number;
    target_budget: number;
    consecutive_days: number;
  };
  pause_condition: {
    max_roas: number;
    consecutive_days: number;
  };
}

export async function runAdsAutopilot(): Promise<{ success: boolean; logs: string[] }> {
  const supabase = await createClient();
  const logs: string[] = [];

  // Fetch active or paused campaigns (only Meta for now)
  const { data: campaigns, error: campErr } = await supabase
    .from("campaigns")
    .select("*, clients(*)")
    .eq("platform", "meta");

  if (campErr || !campaigns) {
    throw new Error(`Autopilot failed to fetch campaigns: ${campErr?.message || "No campaigns"}`);
  }

  // Fetch Founder phone for alerts
  const { data: founderProfile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("role", "founder")
    .limit(1)
    .maybeSingle();
  const founderPhone = founderProfile?.phone || "9999999999";

  for (const campaign of campaigns) {
    try {
      const client = campaign.clients;
      if (!client) continue;

      // 1. Pull/Simulate Yesterday's Metrics
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

      // Simulate metrics
      const budget = Number(campaign.budget_per_day) || 1000;
      const spend = Math.round(budget * (0.9 + Math.random() * 0.15)); // Spend is close to daily budget
      const impressions = Math.round(spend * (15 + Math.random() * 10));
      const clicks = Math.round(impressions * (0.005 + Math.random() * 0.015)); // CTR is between 0.5% and 2%
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      
      // Simulate performance/ROAS: 60% chance of positive ROI
      const roasMultiplier = Math.random() > 0.4 ? 1.6 + Math.random() * 1.2 : 0.6 + Math.random() * 0.7;
      const simulatedRoas = Math.round(roasMultiplier * 100) / 100;
      // Derived leads based on value (let's assume Rs. 200 per lead value)
      const leadValue = 200;
      const leads = Math.round((spend * simulatedRoas) / leadValue);

      // Insert daily metrics record
      const { data: metricsRow, error: metricsErr } = await supabase
        .from("metrics_daily")
        .insert({
          campaign_id: campaign.id,
          date: yesterdayStr,
          spend,
          impressions,
          clicks,
          leads,
          results: {
            roas: simulatedRoas,
            ctr_percentage: Math.round(ctr * 10000) / 100,
            cpc: Math.round(cpc * 100) / 100,
          },
        })
        .select()
        .single();

      if (metricsErr) {
        console.error("Failed to insert daily metrics row:", metricsErr);
        continue;
      }

      console.log("Logged metrics row details:", metricsRow);
      logs.push(`Logged metrics for Campaign: ${campaign.id} on ${yesterdayStr}. ROAS: ${simulatedRoas}`);

      // 2. Load and parse campaign Custom rules
      const rules = (campaign.optimisation_rules || {}) as AutopilotRuleSet;
      
      // Fetch historical metrics to check consecutive trends
      const { data: history } = await supabase
        .from("metrics_daily")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("date", { ascending: false })
        .limit(5);

      const metricsList = history || [];

      // Helper to evaluate consecutive conditions
      const checkConsecutiveMaxRoas = (threshold: number, days: number): boolean => {
        if (metricsList.length < days) return false;
        for (let i = 0; i < days; i++) {
          const rowRoas = Number((metricsList[i].results as Record<string, unknown>)?.roas || 0);
          if (rowRoas >= threshold) return false;
        }
        return true;
      };

      // 3. Rule compiler evaluation
      let actionType: "scale" | "trim" | "pause" | "hold" = "hold";
      let proposedBudget = Number(campaign.budget_per_day);
      let note = "";

      const scaleRules = rules.scale_condition;
      const trimRules = rules.trim_condition;
      const pauseRules = rules.pause_condition;

      // Evaluate PAUSE first (highest precedence)
      if (pauseRules && checkConsecutiveMaxRoas(pauseRules.max_roas, pauseRules.consecutive_days)) {
        actionType = "pause";
        note = `Blended ROAS < ${pauseRules.max_roas}x for ${pauseRules.consecutive_days} consecutive days.`;
      } 
      // Evaluate TRIM next
      else if (trimRules && checkConsecutiveMaxRoas(trimRules.max_roas, trimRules.consecutive_days)) {
        actionType = "trim";
        proposedBudget = trimRules.target_budget;
        note = `Blended ROAS < ${trimRules.max_roas}x for ${trimRules.consecutive_days} consecutive days.`;
      }
      // Evaluate SCALE next
      else if (scaleRules && simulatedRoas >= scaleRules.min_roas) {
        actionType = "scale";
        proposedBudget = Number(campaign.budget_per_day) + Number(scaleRules.increase_amount);
        note = `Blended ROAS (${simulatedRoas}x) >= ${scaleRules.min_roas}x threshold.`;

        // Safety cap limit checks
        const hardDailyClientCap = Math.round(Number(client.ad_budget || 30000) / 30);
        const rulesCap = scaleRules.cap_budget || hardDailyClientCap;
        const finalCap = Math.min(rulesCap, hardDailyClientCap);

        if (proposedBudget > finalCap) {
          proposedBudget = finalCap;
          note += ` Budget scaled and capped at safety limit Rs. ${finalCap}.`;
        }
      } else {
        note = `Blended ROAS is ${simulatedRoas}x. Hold current daily pacing budget.`;
      }

      // 4. Mode Routing Action Execution / Recommendation
      const controlMode = campaign.control_mode; // 'draft_only', 'founder_approval_required', 'auto_within_budget'

      if (actionType !== "hold") {
        if (controlMode === "auto_within_budget" && campaign.status === "ACTIVE") {
          // A. Auto adjust
          if (actionType === "pause") {
            // Update status to paused in database
            await supabase.from("campaigns").update({ status: "PAUSED" }).eq("id", campaign.id);
            // Log to ad_ops_audit
            await supabase.from("ad_ops_audit").insert({
              client_id: campaign.client_id,
              campaign_id: campaign.id,
              action_type: "autopilot_pause_campaign",
              status: "success",
              payload: { reason: note },
              response: { campaign_id: campaign.id, new_status: "PAUSED" },
              actor_role: "system",
            });

            await sendWhatsAppText({
              to: founderPhone,
              text: `🤖 Autopilot Action Executed for [${client.name}]: Campaign PAUSED. Reason: ${note} ✅`,
            });
          } else {
            // scale or trim budget
            await supabase.from("campaigns").update({ budget_per_day: proposedBudget }).eq("id", campaign.id);
            // Log to ad_ops_audit
            await supabase.from("ad_ops_audit").insert({
              client_id: campaign.client_id,
              campaign_id: campaign.id,
              action_type: `autopilot_${actionType}_budget`,
              status: "success",
              payload: { reason: note, old_budget: campaign.budget_per_day, proposed_budget: proposedBudget },
              response: { campaign_id: campaign.id, new_budget: proposedBudget },
              actor_role: "system",
            });

            await sendWhatsAppText({
              to: founderPhone,
              text: `🤖 Autopilot Action Executed for [${client.name}]: Daily budget set to Rs. ${proposedBudget} (${actionType}). Reason: ${note} ✅`,
            });
          }
        } 
        else if (controlMode === "founder_approval_required" && campaign.status === "ACTIVE") {
          // B. Add recommendation pending approvals
          const approvalDetails = {
            campaign_id: campaign.id,
            action: actionType,
            proposed_budget: proposedBudget,
            reason: note,
          };
          console.log("Autopilot recommendation created:", approvalDetails);

          const { data: recApproval } = await supabase
            .from("approvals")
            .insert({
              client_id: campaign.client_id,
              entity_type: "campaign",
              entity_id: campaign.id,
              approver_role: "founder",
              channel: "whatsapp",
              decision: "pending",
              feedback_text: `Recommendation: ${actionType.toUpperCase()} campaign. Detail: ${note}`,
            })
            .select()
            .single();

          if (recApproval) {
            // Send WhatsApp report suggestion with approval link
            const simulatorLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://bron.digital"}/dashboard/approvals`;
            await sendWhatsAppText({
              to: founderPhone,
              text: `🤖 Autopilot Recommendation for [${client.name}]:\n- Suggested Action: *${actionType.toUpperCase()}*\n- Reason: ${note}\n- Approve suggestion here: ${simulatorLink}`,
            });
          }
        }
      }

      // 5. Short Daily Performance Report per client
      const reportMsg = `📊tbw-os Daily Client Report: [${client.name}]\n` +
        `- Campaign Status: ${campaign.status}\n` +
        `- Pacing Budget: Rs. ${campaign.budget_per_day}\n` +
        `- Yesterday Spend: Rs. ${spend}\n` +
        `- Impressions: ${impressions}\n` +
        `- Clicks: ${clicks} (CTR: ${(ctr * 100).toFixed(2)}%)\n` +
        `- Leads: ${leads}\n` +
        `- Blended ROAS: ${simulatedRoas}x\n` +
        `- Autopilot status: Checked (Mode: ${controlMode})`;

      await sendWhatsAppText({
        to: founderPhone,
        text: reportMsg,
      });

      // 6. Hard safety alerts checking
      // Alert 1: Overspend vs Cap
      if (spend > budget * 1.15) {
        await sendWhatsAppText({
          to: founderPhone,
          text: `🚨 tbw-os Autopilot ALERT: [${client.name}] Campaign daily budget overspend risk! Spent Rs. ${spend} against cap limit Rs. ${budget}.`,
        });
      }

      // Alert 2: CTR Collapse below 0.2%
      if (ctr < 0.002 && impressions > 500) {
        await sendWhatsAppText({
          to: founderPhone,
          text: `🚨 tbw-os Autopilot ALERT: [${client.name}] CTR Collapse detected! Yesterday CTR fell to ${(ctr * 100).toFixed(2)}%. Please review creatives.`,
        });
      }

      // Alert 3: Zero Delivery
      if (impressions === 0 && campaign.status === "ACTIVE") {
        await sendWhatsAppText({
          to: founderPhone,
          text: `🚨 tbw-os Autopilot ALERT: [${client.name}] Active Campaign has ZERO delivery! No impressions served yesterday.`,
        });
      }

      // Alert 4: Simulated Disapproved ads alert (5% chance in sandbox check)
      if (Math.random() < 0.05) {
        await sendWhatsAppText({
          to: founderPhone,
          text: `🚨 tbw-os Autopilot ALERT: [${client.name}] Disapproved Ads flagged! Meta has rejected 1 ad asset. Action required.`,
        });
      }

    } catch (campaignError) {
      console.error(`Error processing campaign ${campaign.id} inside autopilot:`, campaignError);
    }
  }

  return { success: true, logs };
}
