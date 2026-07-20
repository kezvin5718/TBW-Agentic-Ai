import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
          status: status,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }
      resultPlan = data;
    }

    return NextResponse.json({
      success: true,
      plan: resultPlan,
    });
  } catch (error: unknown) {
    console.error("Save Plan Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
