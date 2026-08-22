import { SupabaseClient } from "@supabase/supabase-js";
import { complete } from "./llm";
import { MODEL_SMART } from "./llm-config";
import { fmtIST } from "./time";

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

  // Creatives reach a client through their task — the old count had no client
  // filter at all, so every client was shown the agency-wide total.
  const { data: clientTaskRows } = await supabase.from("tasks").select("id").eq("client_id", client.id);
  const taskIds = (clientTaskRows || []).map((t) => t.id);
  let publishedCount = 0;
  if (taskIds.length > 0) {
    const { count } = await supabase
      .from("creatives")
      .select("*", { count: "exact", head: true })
      .in("task_id", taskIds)
      .not("published_at", "is", null);
    publishedCount = count || 0;
  }

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
  // Tasks carry client_id directly now — reaching for it only through
  // monthly_plans left every imported and WhatsApp task showing "Unknown".
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, type, deadline, priority, assignee_name, client:clients(name), plan:monthly_plans(clients(name))")
    .neq("status", "done")
    .lt("deadline", now)
    .order("deadline", { ascending: true })
    .limit(40);

  if (error) {
    return `Error fetching overdue tasks: ${error.message}`;
  }

  if (!data || data.length === 0) {
    return "No overdue tasks found.";
  }

  let output = `Overdue Tasks (${data.length}):\n`;
  data.forEach((task) => {
    const client =
      (task.client as { name?: string } | null)?.name ||
      (task.plan as { clients?: { name?: string } } | null)?.clients?.name ||
      "No client";
    output += `- ${task.title || task.description || "(untitled)"}\n  Client: ${client} | ${String(task.type).toUpperCase()} | ${task.priority}\n  With: ${task.assignee_name || "unassigned"} | Due: ${fmtIST(task.deadline as string)}\n`;
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
      purpose: "bron-assistant",
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
      purpose: "bron-assistant",
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

  // This used to return an invented plan — hardcoded pickle-company text, the
  // same for every client. Bron reports what actually exists; plans are made
  // and imported in Campaign Planning, not composed in chat.
  let q = supabase
    .from("monthly_plans")
    .select("month, status, strategy_summary, content_calendar")
    .eq("client_id", client.id)
    .order("month", { ascending: false })
    .limit(1);
  if (monthStr && /^\d{4}-\d{2}/.test(monthStr)) {
    q = supabase
      .from("monthly_plans")
      .select("month, status, strategy_summary, content_calendar")
      .eq("client_id", client.id)
      .eq("month", `${monthStr.slice(0, 7)}-01`)
      .limit(1);
  }
  const { data: plans } = await q;
  const plan = plans?.[0];
  if (!plan) {
    return `${client.name} has no plan on file${monthStr ? ` for ${monthStr}` : ""}. Create or import one in Campaign Planning — Bron can then report on it.`;
  }

  const cal = (plan.content_calendar as Array<Record<string, unknown>> | null) || [];
  const withDirection = cal.filter((r) => String(r.productionNote || "").trim()).length;
  const withCaption = cal.filter((r) => String(r.caption || "").trim()).length;
  const reels = cal.filter((r) => String(r.format || "").toLowerCase().includes("reel")).length;

  return `Plan for ${client.name} — ${String(plan.month).slice(0, 7)} (${plan.status}):
- ${cal.length} calendar rows: ${reels} reels, ${cal.length - reels} static/carousel.
- ${withDirection} rows carry the author's production direction, ${withCaption} carry a written caption.
- Strategy: ${String(plan.strategy_summary || "not recorded").slice(0, 220)}
To change it, use Campaign Planning; to produce stills from it, use Plan → Posts.`;
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

  // Real numbers only. The old version returned the same invented ROAS and a
  // pickle-recipe reel for every client — a report that reads plausibly and is
  // entirely fiction is worse than none.
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const weekAhead = new Date(now + 7 * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: posted } = await supabase
    .from("social_posts")
    .select("platform, content_type, status, scheduled_for")
    .eq("client_id", client.id)
    .gte("scheduled_for", weekAgo)
    .lte("scheduled_for", nowIso);
  const { data: upcoming } = await supabase
    .from("social_posts")
    .select("platform, scheduled_for, status")
    .eq("client_id", client.id)
    .gt("scheduled_for", nowIso)
    .lte("scheduled_for", weekAhead);
  const { count: waiting } = await supabase
    .from("creative_uploads")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("status", "uploaded")
    .eq("qc_status", "match");
  const { count: rejected } = await supabase
    .from("creative_uploads")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("status", "rejected");

  const went = (posted || []).filter((p) => p.status !== "failed");
  const failed = (posted || []).filter((p) => p.status === "failed");
  const byType = went.reduce<Record<string, number>>((a, p) => { a[p.content_type] = (a[p.content_type] || 0) + 1; return a; }, {});
  const typeLine = Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(", ") || "nothing";

  return `Week report for ${client.name} (organic posting — ad metrics are not connected):
- Went out in the last 7 days: ${went.length} post(s) (${typeLine}).${failed.length ? ` ${failed.length} FAILED to publish — check the Library.` : ""}
- Scheduled for the next 7 days: ${(upcoming || []).length} post(s).
- Approved and waiting in Automation: ${waiting || 0}. Rejected at QC awaiting a fix: ${rejected || 0}.`;
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

// ==========================================
// 4. THE PIPELINE BRON COULD NOT SEE
// Content Hub, Social Publisher and the WhatsApp task bot were all built after
// Bron's original tools, so he had no idea any of them existed.
// ==========================================

/** What designers have delivered that nobody has posted yet. */
export async function get_content_hub_status(supabase: SupabaseClient, clientName?: string) {
  let q = supabase
    .from("creative_uploads")
    .select("content_type, media_type, qc_status, qc_detected_brand, created_at, clients(name), profiles:uploaded_by(name)")
    .eq("status", "uploaded")
    .order("created_at", { ascending: false })
    .limit(100);

  if (clientName) {
    const { data: c } = await supabase.from("clients").select("id").ilike("name", `%${clientName}%`).maybeSingle();
    if (!c) return `Client "${clientName}" not found.`;
    q = q.eq("client_id", c.id);
  }

  const { data, error } = await q;
  if (error) return `Error reading the Content Hub: ${error.message}`;
  if (!data || data.length === 0) {
    return clientName ? `Nothing waiting in the Content Hub for ${clientName}.` : "Content Hub is empty — nothing waiting to be posted.";
  }

  const byClient: Record<string, Record<string, number>> = {};
  const flagged: string[] = [];
  for (const u of data) {
    const name = (u.clients as { name?: string } | null)?.name || "Unknown client";
    byClient[name] = byClient[name] || {};
    byClient[name][u.content_type] = (byClient[name][u.content_type] || 0) + 1;
    if (u.qc_status === "mismatch") {
      flagged.push(`${name}: a ${u.content_type} looks like ${u.qc_detected_brand || "another brand"}`);
    }
  }

  let out = `Waiting in Content Hub (${data.length} file(s)):\n`;
  for (const [name, types] of Object.entries(byClient)) {
    out += `- ${name}: ${Object.entries(types).map(([t, n]) => `${n} ${t}`).join(", ")}\n`;
  }
  if (flagged.length > 0) out += `\nBrand QC flagged ${flagged.length}:\n${flagged.slice(0, 5).map((f) => `- ${f}`).join("\n")}\n`;
  return out;
}

/** What is scheduled, what went out, and — most importantly — what failed. */
export async function get_social_queue(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("social_posts")
    .select("platform, content_type, status, scheduled_for, created_at, webhook_response, clients(name)")
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) return `Error reading the publishing queue: ${error.message}`;
  if (!data || data.length === 0) return "Nothing in the publishing queue yet.";

  const now = Date.now();
  const failed = data.filter((p) => p.status === "failed");
  const scheduled = data.filter((p) => p.status === "sent" && p.scheduled_for && new Date(p.scheduled_for).getTime() > now);
  const posted = data.filter((p) => p.status === "sent" && !(p.scheduled_for && new Date(p.scheduled_for).getTime() > now));

  let out = `Publishing queue: ${scheduled.length} scheduled, ${posted.length} already out, ${failed.length} failed.\n`;

  if (scheduled.length > 0) {
    out += `\nNext up:\n`;
    scheduled
      .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))
      .slice(0, 5)
      .forEach((p) => {
        out += `- ${(p.clients as { name?: string } | null)?.name || "?"} · ${p.content_type} on ${p.platform} · ${fmtIST(p.scheduled_for as string)}\n`;
      });
  }

  if (failed.length > 0) {
    out += `\nFailed — these need attention:\n`;
    failed.slice(0, 6).forEach((p) => {
      const why = String(p.webhook_response || "").replace(/^\[recurpost\]\s*/, "").slice(0, 110);
      out += `- ${(p.clients as { name?: string } | null)?.name || "?"} · ${p.content_type} on ${p.platform}\n  ${why}\n`;
    });
  }
  return out;
}

/** Tasks the WhatsApp bot drafted that are still waiting for a human. */
export async function get_whatsapp_drafts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("wa_task_drafts")
    .select("title, priority, client_uncertain, group_name, suggested_assignee, created_at, clients(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return `Error reading WhatsApp drafts: ${error.message}`;
  if (!data || data.length === 0) return "No WhatsApp task drafts waiting for approval.";

  let out = `${data.length} task(s) drafted from WhatsApp, waiting for approval:\n`;
  data.forEach((d) => {
    const client = (d.clients as { name?: string } | null)?.name || d.group_name || "unknown";
    out += `- ${d.title}\n  ${client}${d.client_uncertain ? " (brand NOT confirmed)" : ""} | ${d.priority} | suggested: ${d.suggested_assignee || "nobody"}\n`;
  });
  return out;
}

// ==========================================
// 4. NEW SURFACES — festivals, automation, Drive
// Bron answers for what the portal can actually do today; a section that his
// tool list does not cover is a section he confidently knows nothing about.
// ==========================================

export async function get_festivals(supabase: SupabaseClient) {
  const { data: fests } = await supabase
    .from("festivals")
    .select("id, name, scheduled_at")
    .order("scheduled_at", { ascending: true });
  if (!fests || fests.length === 0) {
    return "No festivals on the list. Add them under 8b · Festivals in the sidebar.";
  }
  const { data: linked } = await supabase
    .from("creative_uploads")
    .select("festival_id, status")
    .not("festival_id", "is", null);
  const counts = new Map<string, { total: number; scheduled: number }>();
  for (const u of linked || []) {
    const c = counts.get(u.festival_id as string) || { total: 0, scheduled: 0 };
    c.total++;
    if (u.status === "scheduled") c.scheduled++;
    counts.set(u.festival_id as string, c);
  }
  const now = Date.now();
  const lines = fests.map((f) => {
    const when = new Date(f.scheduled_at as string);
    const c = counts.get(f.id as string);
    const past = when.getTime() < now;
    const dateStr = when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return `- ${f.name} — ${dateStr} IST${past ? " (past)" : ""}${c ? ` · ${c.scheduled}/${c.total} creative(s) scheduled` : " · no creative uploaded yet"}`;
  });
  return `Festivals (${fests.length}):\n${lines.join("\n")}`;
}

export async function get_automation_status(supabase: SupabaseClient, clientName?: string) {
  let clientId: string | null = null;
  let label = "all clients";
  if (clientName) {
    const { data: client } = await supabase.from("clients").select("id, name").ilike("name", `%${clientName}%`).maybeSingle();
    if (!client) return `Client "${clientName}" not found.`;
    clientId = client.id as string;
    label = client.name as string;
  }
  let approvedQ = supabase.from("creative_uploads").select("id, caption, client_id, clients(name)")
    .eq("status", "uploaded").eq("qc_status", "match").is("festival_id", null).neq("content_type", "thumbnail");
  let rejectedQ = supabase.from("creative_uploads").select("id", { count: "exact", head: true }).eq("status", "rejected");
  if (clientId) { approvedQ = approvedQ.eq("client_id", clientId); rejectedQ = rejectedQ.eq("client_id", clientId); }
  const { data: approved } = await approvedQ;
  const { count: rejectedCount } = await rejectedQ;
  const rows = approved || [];
  const noCaption = rows.filter((r) => !String(r.caption || "").trim()).length;
  if (rows.length === 0 && !rejectedCount) return `Nothing waiting in Automation for ${label}.`;
  const byClient = rows.reduce<Record<string, number>>((a, r) => {
    const n = (r.clients as { name?: string } | null)?.name || "unknown";
    a[n] = (a[n] || 0) + 1; return a;
  }, {});
  const clientLine = clientId ? "" : `\nBy client: ${Object.entries(byClient).map(([n, c]) => `${n} (${c})`).join(", ")}`;
  return `Automation for ${label}: ${rows.length} creative(s) approved and waiting to schedule.${noCaption ? ` ${noCaption} still need a caption — the "Write missing captions" button in the Automation tab fills them.` : " All captions written."}${rejectedCount ? ` ${rejectedCount} rejected at QC awaiting a fixed re-upload.` : ""}${clientLine}`;
}

export async function get_drive_health() {
  // Drive going down takes uploads, generation and festival stories with it —
  // worth being able to ask about directly.
  const { getDriveStatus, getDriveQuota } = await import("@/lib/google-drive");
  const status = await getDriveStatus();
  if (!status.configured) return "Google Drive is not configured on this server.";
  if (!status.connected) return `Google Drive is DISCONNECTED${status.error ? ` — ${status.error}` : ""}. Reconnect it under Settings → Integrations; uploads, post generation and festival stories are all blocked until then.`;
  const quota = await getDriveQuota();
  const quotaLine = quota
    ? ` Storage: ${quota.usedGb.toFixed(1)} GB used${quota.limitGb ? ` of ${quota.limitGb} GB (${quota.percent?.toFixed(0)}%)` : ""}.`
    : "";
  return `Google Drive is connected as ${status.email || "unknown account"}.${quotaLine}`;
}

/**
 * What is happening in one brand's WhatsApp right now — group and DMs together.
 * The question this answers is the one a founder actually asks: has the client
 * said something we haven't answered?
 */
export async function get_group_activity(supabase: SupabaseClient, clientName: string) {
  const { data: client } = await supabase
    .from("clients").select("id, name, whatsapp_group_id").ilike("name", `%${clientName}%`).maybeSingle();
  if (!client) return `Client "${clientName}" not found.`;

  const { data: contacts } = await supabase.from("wa_contacts").select("number").eq("client_id", client.id);
  const dmNumbers = (contacts || []).map((c) => c.number);

  let q = supabase
    .from("wa_inbox")
    .select("sender_name, sender_number, message_text, media_kind, media_note, media_url, from_me, is_dm, received_at")
    .order("received_at", { ascending: false })
    .limit(15);
  if (client.whatsapp_group_id && dmNumbers.length > 0) {
    q = q.or(`group_jid.eq.${client.whatsapp_group_id},sender_number.in.(${dmNumbers.join(",")})`);
  } else if (client.whatsapp_group_id) {
    q = q.eq("group_jid", client.whatsapp_group_id);
  } else if (dmNumbers.length > 0) {
    q = q.in("sender_number", dmNumbers);
  } else {
    return `${client.name} has no WhatsApp group mapped and no named DM contacts — nothing to read.`;
  }
  const { data: rows } = await q;
  if (!rows || rows.length === 0) return `Nothing recorded from ${client.name}'s WhatsApp yet.`;

  // Unanswered: the newest message is theirs, not ours, and has sat a while.
  const newest = rows[0];
  const ageHrs = (Date.now() - new Date(newest.received_at as string).getTime()) / 3600000;
  const unanswered = !newest.from_me && ageHrs >= 2
    ? `⚠️ Last word is the client's — unanswered for ${ageHrs.toFixed(0)}h.`
    : "";

  const lines = rows.slice(0, 10).reverse().map((r) => {
    const who = r.from_me ? "us" : r.sender_name || r.sender_number || "client";
    const media = r.media_url ? ` [${r.media_kind}${r.media_note ? `: ${String(r.media_note).slice(0, 120)}` : ""}]` : "";
    const when = fmtIST(r.received_at as string);
    return `- ${when} ${who}${r.is_dm ? " (DM)" : ""}: ${(r.message_text || "").slice(0, 140)}${media}`;
  });

  return `${client.name} — latest WhatsApp activity:\n${unanswered ? unanswered + "\n" : ""}${lines.join("\n")}`;
}

/**
 * The management layer's daily output: what the four managers found this
 * morning, compressed by Ochrester. Built at 7:45 AM IST by cron; if asked
 * earlier, it is built on the spot from live data.
 */
export async function get_manager_brief() {
  const { getTodayBrief } = await import("./manager-brief");
  try {
    return await getTodayBrief();
  } catch (err: unknown) {
    return `The manager brief could not be built: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
