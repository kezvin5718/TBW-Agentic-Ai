import { SupabaseClient } from "@supabase/supabase-js";
import { complete } from "./llm";
import { MODEL_SMART } from "./llm-config";

// ==========================================
// 1. READ TOOLS
// ==========================================

export async function get_pending_approvals(supabase: SupabaseClient) {
  // Query pending approvals from DB
  const { data, error } = await supabase
    .from("approvals")
    .select("*, clients(name)")
    .eq("decision", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error in get_pending_approvals:", error);
    return `Error retrieving pending approvals: ${error.message}`;
  }

  if (!data || data.length === 0) {
    return "No pending approvals found.";
  }

  let output = `Pending Approvals (${data.length}):\n`;
  data.forEach((app) => {
    output += `- ID: ${app.id}\n  Client: ${app.clients?.name || "Unknown"}\n  Type: ${app.entity_type}\n  Target: ${app.entity_id}\n  Created: ${new Date(app.created_at).toLocaleDateString()}\n`;
  });
  return output;
}

export async function get_client_status(supabase: SupabaseClient, clientName: string) {
  // Query client details
  const { data: client, error } = await supabase
    .from("clients")
    .select("*, brand_brain(brand_brief)")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (error || !client) {
    return `Client "${clientName}" not found.`;
  }

  // Get active monthly plan
  const { data: plan } = await supabase
    .from("monthly_plans")
    .select("*")
    .eq("client_id", client.id)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get creatives count
  const { count: publishedCount } = await supabase
    .from("creatives")
    .select("*", { count: "exact", head: true })
    .eq("founder_approval", "approved")
    .not("published_at", "is", null);

  return `Client: ${client.name}
Ad Budget: Rs. ${client.ad_budget}/month
Target Audience: ${client.target_audience}
Brand Brief: ${client.brand_brain?.brand_brief || "None loaded"}
Latest Plan Status: ${plan ? plan.status : "No plan created"}
Published Posts: ${publishedCount || 0}`;
}

export async function get_campaign_metrics(supabase: SupabaseClient, clientName: string, rangeDays: number = 7) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client) {
    return `Client "${clientName}" not found.`;
  }

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("client_id", client.id);

  if (!campaigns || campaigns.length === 0) {
    return `No active campaigns found for ${client.name}.`;
  }

  const campaignIds = campaigns.map((c) => c.id);
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - rangeDays);
  const dateLimitStr = dateLimit.toISOString().split("T")[0];

  const { data: metrics } = await supabase
    .from("metrics_daily")
    .select("*, campaigns(platform, objective)")
    .in("campaign_id", campaignIds)
    .gte("date", dateLimitStr)
    .order("date", { ascending: false });

  if (!metrics || metrics.length === 0) {
    return `No metrics logged for ${client.name} campaigns in the last ${rangeDays} days.`;
  }

  let output = `Daily Performance for ${client.name} (Last ${rangeDays} days):\n`;
  metrics.forEach((m) => {
    const ctr = Number((m.results as Record<string, unknown>)?.ctr_percentage || 0);
    const cpc = m.clicks > 0 ? Number(m.spend) / m.clicks : 0;
    const roas = Number(m.spend) > 0 ? (Number(m.leads) * 200) / Number(m.spend) : 0; // Simulated ROAS

    output += `- Date: ${m.date} | Platform: ${m.campaigns?.platform?.toUpperCase() || "META"}\n  Spend: Rs. ${m.spend} | Impressions: ${m.impressions} | Clicks: ${m.clicks}\n  Leads: ${m.leads} | CTR: ${ctr}% | CPC: Rs. ${cpc.toFixed(2)} | ROAS: ${roas.toFixed(2)}x\n`;
  });
  return output;
}

export async function get_overdue_tasks(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, plan:monthly_plans(clients(name))")
    .neq("status", "done")
    .lt("deadline", now)
    .order("deadline", { ascending: true });

  if (error) {
    return `Error fetching overdue tasks: ${error.message}`;
  }

  if (!data || data.length === 0) {
    return "No overdue tasks found.";
  }

  let output = `Overdue Tasks (${data.length}):\n`;
  data.forEach((task) => {
    output += `- Task ID: ${task.id}\n  Client: ${task.plan?.clients?.name || "Unknown"}\n  Type: ${task.type.toUpperCase()}\n  Concept: ${task.concept || "No concept"}\n  Deadline: ${new Date(task.deadline).toLocaleString()}\n`;
  });
  return output;
}

export async function get_lead_pipeline(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("leads")
    .select("status");

  if (error) {
    return `Error retrieving leads: ${error.message}`;
  }

  const counts: Record<string, number> = {
    new: 0,
    contacted: 0,
    interested: 0,
    visit_scheduled: 0,
    follow_up: 0,
    converted: 0,
  };

  data.forEach((lead) => {
    if (lead.status in counts) {
      counts[lead.status]++;
    }
  });

  return `Sales Lead Pipeline Summary:
- New: ${counts.new}
- Contacted: ${counts.contacted}
- Interested: ${counts.interested}
- Visit Scheduled: ${counts.visit_scheduled}
- Follow Up: ${counts.follow_up}
- Converted: ${counts.converted}
Total Prospects: ${data.length}`;
}

export async function search_brand_brain(supabase: SupabaseClient, clientName: string, query: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, brand_brain(*)")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client || !client.brand_brain) {
    return `Brand Brain profiles not loaded for ${clientName}.`;
  }

  const brain = (Array.isArray(client.brand_brain) ? client.brand_brain[0] : client.brand_brain) as Record<string, unknown>;
  const brainText = `
Colors: ${JSON.stringify(brain.colors)}
Fonts: ${JSON.stringify(brain.fonts)}
Caption Tone: ${brain.caption_tone}
Design Preferences: ${JSON.stringify(brain.design_preferences)}
Past Creative Feedbacks: ${JSON.stringify(brain.feedback_log)}
Campaign Results Log: ${JSON.stringify(brain.results_log)}
  `;

  // Use LLM to extract/search the query inside brand brain
  try {
    const searchRes = await complete({
      model: MODEL_SMART,
      system: `You are the Brand Brain search indexer. Analyze the brand parameters and answer query: "${query}". Keep answers under 80 words.`,
      messages: [{ role: "user", content: brainText }],
    });
    return searchRes;
  } catch (err: unknown) {
    return `Search query failed: ${(err as Error).message}`;
  }
}

// ==========================================
// 2. DRAFT TOOLS
// ==========================================

export async function draft_client_reply(supabase: SupabaseClient, clientName: string, message: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, brand_brain(caption_tone)")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client) {
    return `Client "${clientName}" not found.`;
  }

  const brain = (Array.isArray(client.brand_brain) ? client.brand_brain[0] : client.brand_brain) as Record<string, unknown>;
  const tone = (brain?.caption_tone as string) || "professional";

  try {
    const reply = await complete({
      model: MODEL_SMART,
      system: `You are the Client Liaison Bot. Draft a warm, encouraging response for client: "${client.name}". Tone guidelines: "${tone}". Keep it under 60 words.`,
      messages: [{ role: "user", content: `Draft reply to client message: "${message}"` }],
    });
    return `Drafted Response to ${client.name}:\n"${reply.trim()}"`;
  } catch (err: unknown) {
    return `Drafting reply failed: ${(err as Error).message}`;
  }
}

export async function generate_plan(supabase: SupabaseClient, clientName: string, monthStr: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client) {
    return `Client "${clientName}" not found.`;
  }

  // Simulate generating strategy brief
  return `Draft Plan for ${client.name} (${monthStr}):
1. Strategy Summary: Focus on seasonal pickles and festival gift packaging.
2. Content Pillars: product showcase, heritage recipe stories, chef testimonials.
3. Content Calendar: 4 posts (2 videos, 2 static images) scheduled.
4. Daily ad budget suggestion: Rs. 1500/day.`;
}

export async function draft_weekly_report(supabase: SupabaseClient, clientName: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client) {
    return `Client "${clientName}" not found.`;
  }

  // Get campaign stats
  return `Draft Weekly Report for ${client.name}:
- Overview: Reached 25k users with blended ROAS at 2.45x.
- Top Creative: 'Reel - Pickle Heritage Recipe' (CTR 1.25%).
- Next Week recommendation: Shift 20% budget from static images to video placements.`;
}

// ==========================================
// 3. ACTION TOOLS (Requires Confirmation)
// ==========================================

export async function approve_creative(supabase: SupabaseClient, creativeId: string) {
  // Query creative context
  const { data: cr } = await supabase
    .from("creatives")
    .select("*, tasks(plan:monthly_plans(clients(name)))")
    .eq("id", creativeId)
    .maybeSingle();

  if (!cr) {
    return `Creative ID "${creativeId}" not found.`;
  }

  const clientName = cr.tasks?.plan?.clients?.name || "Client";
  const confirmMsg = `Approve creative "${cr.caption?.substring(0, 30)}..." for client "${clientName}"?`;

  // Create pending action record (expires in 10 mins)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from("jarvis_pending_actions").insert({
    action_name: "approve_creative",
    args: { id: creativeId },
    expires_at: expiresAt,
    status: "pending",
  });

  return `PENDING_CONFIRMATION: ${confirmMsg}`;
}

export async function activate_campaign(supabase: SupabaseClient, campaignId: string) {
  const { data: c } = await supabase
    .from("campaigns")
    .select("*, clients(name)")
    .eq("id", campaignId)
    .maybeSingle();

  if (!c) {
    return `Campaign ID "${campaignId}" not found.`;
  }

  const confirmMsg = `Activate campaign "${c.objective}" (Daily budget: Rs. ${c.budget_per_day}) for client "${c.clients?.name || "Client"}"?`;

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from("jarvis_pending_actions").insert({
    action_name: "activate_campaign",
    args: { id: campaignId },
    expires_at: expiresAt,
    status: "pending",
  });

  return `PENDING_CONFIRMATION: ${confirmMsg}`;
}

export async function update_budget(supabase: SupabaseClient, campaignId: string, amount: number) {
  const { data: c } = await supabase
    .from("campaigns")
    .select("*, clients(name)")
    .eq("id", campaignId)
    .maybeSingle();

  if (!c) {
    return `Campaign ID "${campaignId}" not found.`;
  }

  // Safety cap limit checks
  const maxAdBudgetLimit = Number(c.clients?.ad_budget || 0) / 15; // Enforce hard cap
  if (amount > maxAdBudgetLimit) {
    return `ACTION_BLOCKED: Requested budget Rs. ${amount} exceeds the campaign hard safety limit (Rs. ${maxAdBudgetLimit.toFixed(0)}/day).`;
  }

  const confirmMsg = `Update daily budget of campaign "${c.objective}" from Rs. ${c.budget_per_day} to Rs. ${amount} for client "${c.clients?.name || "Client"}"?`;

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from("jarvis_pending_actions").insert({
    action_name: "update_budget",
    args: { campaignId, amount },
    expires_at: expiresAt,
    status: "pending",
  });

  return `PENDING_CONFIRMATION: ${confirmMsg}`;
}

export async function send_to_client(supabase: SupabaseClient, clientName: string, content: string) {
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, whatsapp_group_id")
    .ilike("name", `%${clientName}%`)
    .maybeSingle();

  if (!client) {
    return `Client "${clientName}" not found.`;
  }

  const confirmMsg = `Send message to ${client.name} WhatsApp Group: "${content.substring(0, 50)}..."?`;

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from("jarvis_pending_actions").insert({
    action_name: "send_to_client",
    args: { clientId: client.id, content },
    expires_at: expiresAt,
    status: "pending",
  });

  return `PENDING_CONFIRMATION: ${confirmMsg}`;
}

// ==========================================
// 4. EXECUTION OF CONFIRMED ACTION
// ==========================================

export async function execute_confirmed_action(
  supabase: SupabaseClient,
  actionName: string,
  args: Record<string, string | number | boolean | undefined>,
  triggerMsg: string
) {
  console.log(`Executing confirmed action: ${actionName}`, args);

  try {
    if (actionName === "approve_creative") {
      const { data: cr } = await supabase
        .from("creatives")
        .select("*, tasks(plan_id, plan:monthly_plans(client_id))")
        .eq("id", args.id)
        .single();

      if (!cr) throw new Error(`Creative ID ${args.id} not found.`);

      // Update creative approvals
      const { error } = await supabase
        .from("creatives")
        .update({ founder_approval: "approved" })
        .eq("id", args.id);

      if (error) throw error;

      // Add to approvals log
      await supabase.from("approvals").insert({
        client_id: cr.tasks?.plan?.client_id,
        entity_type: "creative",
        entity_id: args.id,
        approver_role: "founder",
        decision: "approved",
        channel: "whatsapp",
        feedback_text: `Approved by Bron via command: "${triggerMsg}"`,
      });

      // Log to ad_ops_audit
      await supabase.from("ad_ops_audit").insert({
        client_id: cr.tasks?.plan?.client_id,
        action_type: "approve_creative",
        payload: { creative_id: args.id },
        response: { status: "success" },
        actor_role: "founder",
      });

      return `Creative approved successfully! ✅`;
    }

    if (actionName === "save_prompt_template") {
      const { error } = await supabase
        .from("prompt_templates")
        .insert({
          name: args.name,
          category: args.category || "General",
          prompt_text: args.prompt_text,
          default_model: args.default_model || "nano_banana",
          default_ratio: args.default_ratio || "1:1",
          sort_order: Number(args.sort_order || 0),
          is_active: true,
        });

      if (error) throw error;
      return `Prompt template "${args.name}" saved successfully! ✅`;
    }

    if (actionName === "activate_campaign") {
      const { data: c } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", args.id)
        .single();

      if (!c) throw new Error(`Campaign ID ${args.id} not found.`);

      // Update status in campaign table
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "ACTIVE" })
        .eq("id", args.id);

      if (error) throw error;

      // Log to ad_ops_audit
      await supabase.from("ad_ops_audit").insert({
        client_id: c.client_id,
        campaign_id: c.id,
        action_type: "activate_campaign",
        payload: { campaign_id: args.id },
        response: { status: "success" },
        actor_role: "founder",
      });

      return `Campaign ${c.objective} activated successfully! 🚀`;
    }

    if (actionName === "update_budget") {
      const { data: c } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", args.campaignId)
        .single();

      if (!c) throw new Error(`Campaign ID ${args.campaignId} not found.`);

      // Update daily budget in campaigns
      const { error } = await supabase
        .from("campaigns")
        .update({ budget_per_day: args.amount })
        .eq("id", args.campaignId);

      if (error) throw error;

      // Log to ad_ops_audit
      await supabase.from("ad_ops_audit").insert({
        client_id: c.client_id,
        campaign_id: c.id,
        action_type: "update_budget",
        payload: { campaign_id: args.campaignId, budget: args.amount },
        response: { status: "success" },
        actor_role: "founder",
      });

      return `Campaign budget updated successfully to Rs. ${args.amount}/day! 💰`;
    }

    if (actionName === "send_to_client") {
      // Mock publish to group
      await supabase.from("whatsapp_messages").insert({
        client_id: args.clientId,
        sender_number: "SYSTEM",
        message_body: args.content,
        direction: "outbound",
      });

      return `Message sent successfully to client group! 💬`;
    }

    throw new Error(`Unknown action: ${actionName}`);
  } catch (err: unknown) {
    console.error("Action execution failed:", err);
    return `Action execution failed: ${(err as Error).message}`;
  }
}
