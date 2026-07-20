import { SupabaseClient } from "@supabase/supabase-js";
import { complete } from "./llm";
import { MODEL_SMART } from "./llm-config";
import * as tools from "./jarvis-tools";

export interface JarvisResponse {
  thought: string;
  tool: string;
  args?: Record<string, string | number | boolean | undefined>;
  response?: string;
}

/**
 * Executes a single command/query loop for Jarvis.
 */
export async function processJarvisCommand(
  supabase: SupabaseClient,
  messageBody: string
): Promise<string> {
  // 1. Fetch system context dynamically to inject in prompt
  const nowStr = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Get current pending items count for system prompt summary
  const { count: pendingApprovalsCount } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("decision", "pending");

  const { count: overdueTasksCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .neq("status", "done")
    .lt("deadline", new Date().toISOString());

  const systemPrompt = `You are Bron, the premium founder-only AI assistant with full system access for TBW Advertising. You must introduce yourself and refer to yourself as Bron.
Today's Date: ${nowStr}
Your Pending Items Summary:
- Pending approvals count: ${pendingApprovalsCount || 0}
- Overdue tasks count: ${overdueTasksCount || 0}

Guidelines:
1. You have full access to search and modify system states (creatives, plans, tasks, campaigns, leads) via tools.
2. Keep all your answers short, concise, and mobile-readable. Put numbers/status first, followed by at most one line of context.
3. If the user asks for a write/action (e.g. approve a post, change budget, activate ad), select the corresponding action tool.
4. NON-NEGOTIABLE safety rule: action tools can be requested by voice, but confirmation must be TYPED (e.g. typing YES as a text message or tapping confirmation card). You must never execute/confirm any action via voice input alone, and you must say so if asked.

You MUST respond in JSON format matching this schema:
{
  "thought": "Explain your reasoning about the user command.",
  "tool": "get_pending_approvals" | "get_client_status" | "get_campaign_metrics" | "get_overdue_tasks" | "get_lead_pipeline" | "search_brand_brain" | "draft_client_reply" | "generate_plan" | "draft_weekly_report" | "approve_creative" | "activate_campaign" | "update_budget" | "send_to_client" | "none",
  "args": { "client": "string", "query": "string", "id": "string", "campaign": "string", "amount": number, "content": "string", "range": number },
  "response": "Provide a direct direct response if no tool is required."
}`;

  try {
    // Turn 1: Classify and request tool
    const rawRes = await complete({
      model: MODEL_SMART,
      system: systemPrompt,
      messages: [{ role: "user", content: messageBody }],
      jsonSchema: { type: "object" },
    });

    const parsed: JarvisResponse = JSON.parse(
      rawRes.replace(/```json/g, "").replace(/```/g, "").trim()
    );

    console.log("Bron Turn 1 parsed response:", parsed);

    if (!parsed.tool || parsed.tool === "none") {
      return parsed.response || "I didn't understand the request. How can I help you today?";
    }

    // Turn 2: Execute tool and return output
    let toolResult = "";
    const args = parsed.args || {};

    switch (parsed.tool) {
      case "get_pending_approvals":
        toolResult = await tools.get_pending_approvals(supabase);
        break;
      case "get_client_status":
        toolResult = await tools.get_client_status(supabase, (args.client as string) || "");
        break;
      case "get_campaign_metrics":
        toolResult = await tools.get_campaign_metrics(supabase, (args.client as string) || "", (args.range as number) || 7);
        break;
      case "get_overdue_tasks":
        toolResult = await tools.get_overdue_tasks(supabase);
        break;
      case "get_lead_pipeline":
        toolResult = await tools.get_lead_pipeline(supabase);
        break;
      case "search_brand_brain":
        toolResult = await tools.search_brand_brain(supabase, (args.client as string) || "", (args.query as string) || "");
        break;
      case "draft_client_reply":
        toolResult = await tools.draft_client_reply(supabase, (args.client as string) || "", (args.query as string) || "");
        break;
      case "generate_plan":
        toolResult = await tools.generate_plan(supabase, (args.client as string) || "", (args.query as string) || "");
        break;
      case "draft_weekly_report":
        toolResult = await tools.draft_weekly_report(supabase, (args.client as string) || "");
        break;

      // Actions
      case "approve_creative":
        toolResult = await tools.approve_creative(supabase, (args.id as string) || "");
        break;
      case "activate_campaign":
        toolResult = await tools.activate_campaign(supabase, (args.id as string) || "");
        break;
      case "update_budget":
        toolResult = await tools.update_budget(supabase, (args.id as string) || (args.campaign as string) || "", Number(args.amount || 0));
        break;
      case "send_to_client":
        toolResult = await tools.send_to_client(supabase, (args.client as string) || "", (args.content as string) || "");
        break;

      default:
        toolResult = `Unknown tool: ${parsed.tool}`;
    }

    // Intercept confirmation strings
    if (toolResult.startsWith("PENDING_CONFIRMATION:")) {
      return toolResult.replace("PENDING_CONFIRMATION:", "").trim();
    }
    if (toolResult.startsWith("ACTION_BLOCKED:")) {
      return toolResult.replace("ACTION_BLOCKED:", "❌ Blocked: ").trim();
    }

    // Format tool results to final mobile-friendly text
    const finalResponse = await complete({
      model: MODEL_SMART,
      system: `You are Bron, formatting tool answers.
Guidelines:
- Keep the final response short and highly readable (mobile-friendly).
- Summarize numbers/details first, then add one line of context.
- Never mention the names of the tools you called. Output the response directly.`,
      messages: [
        { role: "user", content: messageBody },
        { role: "assistant", content: `I have called tool "${parsed.tool}" and retrieved this status:\n${toolResult}` },
        { role: "user", content: "Formulate the final brief mobile-readable response." },
      ],
    });

    return finalResponse.trim();
  } catch (err: unknown) {
    console.error("Bron command loop error:", err);
    return `Bron encountered an error: ${(err as Error).message}`;
  }
}
