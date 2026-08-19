import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface CalendarSlot { format?: string; platform?: string }

/**
 * The month's delivery promise, counted from the calendar itself. This is what
 * production and reporting follow — the onboarding number is only the contract,
 * and the two being different is a fact to surface, not to silently resolve.
 */
function deliverablesFromCalendar(calendar: CalendarSlot[]): Record<string, number | string> {
  const counts = { posts: 0, carousels: 0, stories: 0, reels: 0, other: 0 };
  for (const slot of calendar) {
    const f = String(slot.format || "").toLowerCase();
    if (/carousel/.test(f)) counts.carousels++;
    else if (/story/.test(f)) counts.stories++;
    else if (/reel|video/.test(f)) counts.reels++;
    else if (/static|post|image|photo/.test(f) || f === "") counts.posts++;
    else counts.other++;
  }
  return { total: calendar.length, ...counts, counted_at: new Date().toISOString() };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify session
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const {
      clientId,
      month,
      strategySummary,
      contentPillars,
      contentCalendar,
      budgetSummary,
      status = "draft",
    } = body;

    if (!clientId || !month || !strategySummary) {
      return NextResponse.json({ error: "clientId, month, and strategySummary are required" }, { status: 400 });
    }

    // 1. Format date (first day of the month for key YYYY-MM-01)
    const rawDate = new Date(month);
    const formattedMonth = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, "0")}-01`;

    const deliverables = deliverablesFromCalendar((contentCalendar as CalendarSlot[]) || []);

    // 2. Check if a plan already exists for this client and month
    const { data: existingPlan } = await supabase
      .from("monthly_plans")
      .select("id")
      .eq("client_id", clientId)
      .eq("month", formattedMonth)
      .maybeSingle();

    let resultPlan;
    if (existingPlan) {
      // Update
      const { data, error } = await supabase
        .from("monthly_plans")
        .update({
          strategy_summary: strategySummary,
          content_pillars: contentPillars || [],
          content_calendar: contentCalendar || [],
          budget_summary: budgetSummary || {},
          deliverables,
          status: status,
        })
        .eq("id", existingPlan.id)
        .select()
        .single();

      if (error) {
        throw error;
      }
      resultPlan = data;
    } else {
      // Insert
      const { data, error } = await supabase
        .from("monthly_plans")
        .insert({
          client_id: clientId,
          month: formattedMonth,
          strategy_summary: strategySummary,
          content_pillars: contentPillars || [],
          content_calendar: contentCalendar || [],
          budget_summary: budgetSummary || {},
          deliverables,
          status: status,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }
      resultPlan = data;
    }

    // Contract vs plan — returned so the page can flag a gap the moment it
    // exists, instead of a whole month sliding by under- or over-delivered.
    const { data: client } = await supabase
      .from("clients")
      .select("deliverables_per_month")
      .eq("id", clientId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      plan: resultPlan,
      deliverables,
      contract: client?.deliverables_per_month ?? null,
    });
  } catch (error: unknown) {
    console.error("Save Plan Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
