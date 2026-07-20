import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";

export async function runOverdueDigest() {
  const supabase = await createClient();
  const now = new Date().toISOString();

  // 1. Query overdue tasks (status is not done and deadline has passed)
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

  // 2. Group and compile digest summary text
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

  // 3. Dispatch to Founder via WhatsApp Integration
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

export async function GET() {
  try {
    const result = await runOverdueDigest();
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error: unknown) {
    console.error("Overdue Digest Cron Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
