import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";

/**
 * Turns a burst of WhatsApp group messages into one properly-framed task.
 *
 * Clients don't write one tidy request — they write "change the price" then
 * "to 15000" then "on the gold set" across forty seconds. Read one at a time
 * that's three useless tasks, so messages are first grouped into a
 * conversation, and only then handed to the model.
 *
 * Two rules make that work:
 *  - a cluster is split on a QUIET GAP, not a fixed clock window, so people
 *    still typing stay in the same cluster;
 *  - a cluster is only read once it has gone quiet, otherwise the bot reads
 *    message 1 before 2 and 3 have arrived and we're back to fragments.
 *
 * Everything it produces is a draft. A person approves before it becomes a
 * real task.
 */

const QUIET_GAP_MS = 2 * 60 * 1000; // conversation is over after 2 min of silence
const MAX_CLUSTER_MS = 15 * 60 * 1000; // don't let one busy group become an endless thread
const TASK_TYPES = ["copy", "image", "video", "ads", "design", "video_edit", "ai_video", "script", "planning", "packaging", "print", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

interface InboxRow {
  id: string;
  group_jid: string | null;
  group_name: string | null;
  sender_name: string | null;
  message_text: string | null;
  received_at: string;
  client_id: string | null;
}

interface DraftedTask {
  title: string;
  description: string;
  client: string;
  client_certain: boolean;
  task_type: string;
  priority: string;
  assignee: string;
}

export interface BotResult {
  clusters: number;
  drafted: number;
  skipped: number;
  errors: string[];
}

/** Split one group's messages wherever the group went quiet. */
function splitIntoClusters(rows: InboxRow[]): InboxRow[][] {
  const clusters: InboxRow[][] = [];
  let current: InboxRow[] = [];

  for (const row of rows) {
    if (current.length === 0) { current = [row]; continue; }
    const prev = new Date(current[current.length - 1].received_at).getTime();
    const start = new Date(current[0].received_at).getTime();
    const now = new Date(row.received_at).getTime();

    if (now - prev > QUIET_GAP_MS || now - start > MAX_CLUSTER_MS) {
      clusters.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

export async function runWhatsAppTaskBot(): Promise<BotResult> {
  const out: BotResult = { clusters: 0, drafted: 0, skipped: 0, errors: [] };
  const admin = createServiceRoleClient();

  // Only messages the bot hasn't considered yet. Note this is clustered_at,
  // not draft_id — a conversation that turned out to be chit-chat is closed
  // without a draft, and must not come back round on the next run.
  const { data: rows, error } = await admin
    .from("wa_inbox")
    .select("id, group_jid, group_name, sender_name, message_text, received_at, client_id")
    .is("clustered_at", null)
    .order("received_at", { ascending: true })
    .limit(300);
  if (error) { out.errors.push(`Could not read the inbox: ${error.message}`); return out; }
  if (!rows || rows.length === 0) return out;

  const [{ data: clients }, { data: team }] = await Promise.all([
    admin.from("clients").select("id, name"),
    admin.from("team_members").select("name, role_title").eq("active", true),
  ]);
  const nameToId = new Map((clients || []).map((c) => [c.name.toLowerCase().trim(), c.id]));
  const clientList = (clients || []).map((c) => c.name).join(", ");
  const teamList = (team || []).map((m) => (m.role_title ? `${m.name} (${m.role_title})` : m.name)).join(", ");

  // Group by WhatsApp group, then by conversation.
  const byGroup = new Map<string, InboxRow[]>();
  for (const r of rows as InboxRow[]) {
    const key = r.group_jid || r.group_name || "unknown";
    const list = byGroup.get(key);
    if (list) list.push(r);
    else byGroup.set(key, [r]);
  }

  const ripeBefore = Date.now() - QUIET_GAP_MS;

  for (const [, groupRows] of byGroup) {
    for (const cluster of splitIntoClusters(groupRows)) {
      const lastAt = new Date(cluster[cluster.length - 1].received_at).getTime();
      // Still being typed into — leave it for the next run.
      if (lastAt > ripeBefore) { out.skipped++; continue; }

      out.clusters++;
      const ids = cluster.map((c) => c.id);
      const groupName = cluster[0].group_name || "";
      const transcript = cluster
        .map((c) => `${c.sender_name || "someone"}: ${(c.message_text || "").slice(0, 500)}`)
        .join("\n");

      if (!transcript.replace(/\w+:/g, "").trim()) {
        // Nothing but empty/media-only messages — close them, no draft.
        await admin.from("wa_inbox").update({ extracted: true, clustered_at: new Date().toISOString() }).in("id", ids);
        continue;
      }

      let drafts: DraftedTask[] = [];
      try {
        const raw = await complete({
          system:
            "You turn a marketing agency's client WhatsApp conversations into tasks for their staff. " +
            "The messages are one short conversation — read them together, not separately. " +
            "Only create a task when the client is actually asking the agency to do, change or deliver something. " +
            "Chit-chat, thanks, greetings and approvals ('nice', 'ok', 'good work') are NOT tasks. " +
            "If the conversation contains two genuinely separate requests, return two tasks. Output only JSON.",
          messages: [{
            role: "user",
            content:
              `Known clients: ${clientList || "(none)"}\n` +
              `Team members: ${teamList || "(none)"}\n` +
              `WhatsApp group: "${groupName}"\n\n` +
              `Conversation:\n"""\n${transcript}\n"""\n\n` +
              `Return JSON: { "tasks": [ { ` +
              `"title": "<short imperative task title>", ` +
              `"description": "<what exactly is being asked, including any numbers, prices or names mentioned>", ` +
              `"client": "<exact client name from the known list, or empty if you cannot tell>", ` +
              `"client_certain": <true only if you are sure which client this is>, ` +
              `"task_type": "<one of: ${TASK_TYPES.join(", ")}>", ` +
              `"priority": "<one of: ${PRIORITIES.join(", ")}>", ` +
              `"assignee": "<the team member best suited from the list, or empty>" ` +
              `} ] }\n` +
              `Return { "tasks": [] } if nothing is being asked of the agency.`,
          }],
          model: MODEL_SMART,
          jsonSchema: { type: "object" },
          maxTokens: 700,
        });
        drafts = safeJsonParse<{ tasks: DraftedTask[] }>(raw, { tasks: [] }).tasks || [];
      } catch (err) {
        out.errors.push(`${groupName || "group"}: ${err instanceof Error ? err.message : String(err)}`);
        continue; // leave the messages unclaimed so the next run retries them
      }

      if (drafts.length === 0) {
        // Read and understood — just nothing to do about it. Closed so it is
        // never sent to the model again.
        await admin.from("wa_inbox").update({ extracted: true, is_task: false, clustered_at: new Date().toISOString() }).in("id", ids);
        continue;
      }

      const insertedIds: string[] = [];
      for (const d of drafts) {
        const title = (d.title || "").trim();
        if (!title) continue;

        // Fall back to whatever the per-message pass already matched.
        const matched = d.client ? nameToId.get(d.client.toLowerCase().trim()) || null : null;
        const clientId = matched || cluster.find((c) => c.client_id)?.client_id || null;

        const { data: draft, error: insErr } = await admin.from("wa_task_drafts").insert({
          group_jid: cluster[0].group_jid,
          group_name: groupName || null,
          client_id: clientId,
          client_uncertain: !clientId || d.client_certain === false,
          title: title.slice(0, 200),
          description: (d.description || "").trim().slice(0, 1500) || null,
          task_type: TASK_TYPES.includes(d.task_type) ? d.task_type : "other",
          priority: PRIORITIES.includes(d.priority) ? d.priority : "medium",
          suggested_assignee: (d.assignee || "").trim() || null,
          source_message_ids: ids,
          first_message_at: cluster[0].received_at,
          last_message_at: cluster[cluster.length - 1].received_at,
        }).select("id").single();

        if (insErr) { out.errors.push(`Draft insert failed: ${insErr.message}`); continue; }
        insertedIds.push(draft.id);
        out.drafted++;
      }

      // Claim the messages once the drafts exist, so a conversation is never
      // read twice. If every insert failed, they stay unclaimed and retry.
      if (insertedIds.length > 0) {
        await admin.from("wa_inbox").update({
          draft_id: insertedIds[0], extracted: true, is_task: true, clustered_at: new Date().toISOString(),
        }).in("id", ids);
      }
    }
  }

  return out;
}
