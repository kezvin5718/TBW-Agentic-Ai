import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_SMART } from "@/lib/llm-config";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function GET() {
  const supabase = await createClient();

  // Verify session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const role = user.user_metadata?.role || "client";
  const brandName = user.user_metadata?.brand_name || "";

  let query = supabase.from("weekly_reports").select("*, clients(name)");

  if (role === "client") {
    // Safely resolve client relation by name
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("name", brandName)
      .limit(1)
      .maybeSingle();

    if (!client) {
      return NextResponse.json({ reports: [] });
    }
    query = query.eq("client_id", client.id).eq("status", "sent");
  }

  const { data: reports, error } = await query.order("week_start_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const role = user.user_metadata?.role;
  if (role !== "founder" && role !== "employee") {
    return new NextResponse("Forbidden: Only Founders/Employees can generate/approve reports", { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, clientId, weekStartDate, reportId } = body;

    // Action 1: Generate weekly report suggestion
    if (action === "generate") {
      if (!clientId || !weekStartDate) {
        return NextResponse.json({ error: "Missing parameters for generation" }, { status: 400 });
      }

      // Fetch client
      const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).single();
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

      // Gather weekly metrics
      const { data: campaigns } = await supabase.from("campaigns").select("id").eq("client_id", clientId);
      const campaignIds = (campaigns || []).map((c) => c.id);

      let spendSum = 0;
      let impressionsSum = 0;
      let clicksSum = 0;
      let leadsSum = 0;

      if (campaignIds.length > 0) {
        const { data: metrics } = await supabase
          .from("metrics_daily")
          .select("*")
          .in("campaign_id", campaignIds)
          .gte("date", weekStartDate);

        (metrics || []).forEach((m) => {
          spendSum += Number(m.spend || 0);
          impressionsSum += Number(m.impressions || 0);
          clicksSum += Number(m.clicks || 0);
          leadsSum += Number(m.leads || 0);
        });
      }

      const ctr = impressionsSum > 0 ? (clicksSum / impressionsSum) * 100 : 0;
      const cpc = clicksSum > 0 ? spendSum / clicksSum : 0;
      const roas = spendSum > 0 ? (leadsSum * 200) / spendSum : 0; // assuming lead value is Rs 200

      // Call Gemini to write the report
      const systemPrompt = `You are the Lead Creative Director at TBW Advertising. Write a professional, concise, 1-page client performance summary report.`;
      
      const userPrompt = `
      Write a weekly client performance report for "${client.name}" for the week starting ${weekStartDate}:
      - Total Budget Spent: Rs. ${spendSum}
      - Total Impressions: ${impressionsSum}
      - Total Clicks: ${clicksSum} (CTR: ${ctr.toFixed(2)}%, Avg CPC: Rs. ${cpc.toFixed(2)})
      - Total Conversions/Leads: ${leadsSum}
      - Blended Weekly ROAS: ${roas.toFixed(2)}x

      Write in a clean, print-friendly, professional tone. Structure the content with markdown headers:
      - ### Weekly Overview
      - ### Creative & Performance Breakdown
      - ### Strategy & Recommendations for Next Week

      Make it highly customized and ready to print as a 1-page PDF. Focus on performance details.
      `;

      let reportSummary = "";
      try {
        reportSummary = await complete({
          model: MODEL_SMART,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });
      } catch (llmErr) {
        console.error("Gemini failed to compile weekly report:", llmErr);
        reportSummary = `### Weekly Overview\nBudget Spent: Rs. ${spendSum}\nROAS: ${roas.toFixed(2)}x\n\n### Creative Breakdown\nServed ${impressionsSum} impressions with CTR ${ctr.toFixed(2)}%.\n\n### Strategy\nMaintain active configurations.`;
      }

      // Save report
      const { data: report, error: saveErr } = await supabase
        .from("weekly_reports")
        .insert({
          client_id: clientId,
          week_start_date: weekStartDate,
          summary_content: reportSummary,
          status: "pending_founder_approval",
        })
        .select()
        .single();

      if (saveErr) throw saveErr;

      return NextResponse.json({ success: true, report });
    }

    // Action 2: Founder approves and sends to client WhatsApp
    if (action === "approve") {
      if (!reportId) {
        return NextResponse.json({ error: "Missing reportId for approval" }, { status: 400 });
      }

      // Fetch report
      const { data: report, error: repErr } = await supabase
        .from("weekly_reports")
        .select("*, clients(*)")
        .eq("id", reportId)
        .single();

      if (repErr || !report) {
        return NextResponse.json({ error: "Weekly report not found" }, { status: 404 });
      }

      // Update report status
      await supabase.from("weekly_reports").update({ status: "sent" }).eq("id", reportId);

      // Send to WhatsApp group
      const clientGroup = report.clients?.whatsapp_group_id || "1234567890";
      const summaryFirstLine = report.summary_content.split("\n").filter((l: string) => l.trim().length > 0)[0] || "Weekly Overview";
      
      const textMsg = `📊 Weekly Performance Report Approved & Sent:\n` +
        `Client: *${report.clients?.name}*\n` +
        `Week Start: ${report.week_start_date}\n\n` +
        `Summary details:\n${summaryFirstLine}\n\n` +
        `PDF Report link: http://localhost:3000/dashboard/reporting`;

      await sendWhatsAppText({
        to: clientGroup,
        text: textMsg,
      });

      return NextResponse.json({ success: true, message: "Weekly report approved and dispatched to WhatsApp." });
    }

    return NextResponse.json({ error: "Invalid action parameter" }, { status: 400 });

  } catch (err: unknown) {
    console.error("Weekly report endpoint error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
