import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function runJarvisBriefing() {
  const supabase = await createClient();

  // 1. Fetch pending approvals count
  const { count: pendingCount } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("decision", "pending");

  // 2. Fetch overdue tasks count
  const { count: overdueCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .neq("status", "done")
    .lt("deadline", new Date().toISOString());

  // 3. Fetch yesterday's campaign metrics
  const yesterdayStr = new Date();
  yesterdayStr.setDate(yesterdayStr.getDate() - 1);
  const dateIso = yesterdayStr.toISOString().split("T")[0];

  const { data: metrics } = await supabase
    .from("metrics_daily")
    .select("*, campaigns(id, client_id, platform, objective, clients(name))")
    .eq("date", dateIso);

  // 4. Construct briefing context
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

export async function GET(request: Request) {
  // Simple check for cron authorization (simulated key or Bearer)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runJarvisBriefing();
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error: unknown) {
    console.error("Bron morning briefing failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
