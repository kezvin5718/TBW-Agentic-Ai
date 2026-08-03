import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_FAST } from "@/lib/llm-config";

export const dynamic = "force-dynamic";

interface Extracted { client: string; summary: string; is_task: boolean; urgency: "low" | "medium" | "high" }

/**
 * POST /api/whatsapp-inbox/extract
 * Processes un-extracted inbound WhatsApp group messages: matches the client,
 * writes a short summary, flags whether it's an actionable task, and sets urgency.
 * Founder/employee (or cron). Read-only ingestion — never replies to WhatsApp.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data: rows } = await admin
    .from("wa_inbox")
    .select("id, message_text, group_name, sender_name")
    .eq("extracted", false)
    .order("received_at", { ascending: true })
    .limit(40);
  if (!rows || rows.length === 0) return NextResponse.json({ success: true, processed: 0 });

  const { data: clients } = await admin.from("clients").select("id, name");
  const clientList = (clients || []).map((c) => c.name).join(", ");
  const nameToId = new Map((clients || []).map((c) => [c.name.toLowerCase().trim(), c.id]));

  let processed = 0;
  for (const row of rows) {
    const text = (row.message_text || "").slice(0, 1500);
    let ex: Extracted = { client: "", summary: text.slice(0, 120), is_task: false, urgency: "low" };
    if (text.trim()) {
      try {
        const raw = await complete({
          system: "You triage a marketing agency's client WhatsApp group messages into a staff task board. Output only JSON.",
          messages: [{
            role: "user",
            content: `Known clients: ${clientList || "(none)"}.\nGroup: "${row.group_name || ""}". Sender: "${row.sender_name || ""}".\nMessage: """${text}"""\n\nReturn JSON: { "client": "<best-matching client name from the list, or empty>", "summary": "<one short line of what they want>", "is_task": <true if it asks the agency to do/change/deliver something, else false>, "urgency": "low" | "medium" | "high" }`,
          }],
          model: MODEL_FAST,
          jsonSchema: { type: "object" },
          maxTokens: 200,
        });
        ex = safeJsonParse<Extracted>(raw, ex);
      } catch {
        /* keep fallback */
      }
    }
    const clientId = ex.client ? nameToId.get(ex.client.toLowerCase().trim()) || null : null;
    await admin.from("wa_inbox").update({
      extracted: true,
      client_id: clientId,
      ai_summary: ex.summary || null,
      is_task: !!ex.is_task,
      urgency: ["low", "medium", "high"].includes(ex.urgency) ? ex.urgency : "low",
    }).eq("id", row.id);
    processed++;
  }

  return NextResponse.json({ success: true, processed });
}
