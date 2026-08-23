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
      // The Style Library shelf picked at import. Left out entirely by older
      // callers — and an absent field must never wipe a choice someone made,
      // so only a field that was actually sent is written. "" clears it.
      styleCategory,
      // The colours this month is to be built in, same only-when-provided
      // rule. An empty array is the founder saying "back to the brand brain",
      // so it clears the override rather than storing nothing.
      colorPalette,
      // True when the save is fired automatically right after an import
      // parses. It saves without a click — but never silently over a plan
      // someone authored: that replacement still takes the explicit button.
      autoImport = false,
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
      .select("id, content_calendar")
      .eq("client_id", clientId)
      .eq("month", formattedMonth)
      .maybeSingle();

    if (autoImport && existingPlan) {
      const cal = (existingPlan.content_calendar as Array<{ concept?: string; hook?: string; productionNote?: string }> | null) || [];
      const distinct = new Set(cal.map((r) => `${r.concept || ""}|${r.hook || ""}`.toLowerCase().trim()));
      const authored = cal.length >= 3 && (distinct.size > 2 || cal.some((r) => (r.productionNote || "").trim().length > 10));
      if (authored) {
        return NextResponse.json({
          success: true,
          saved: false,
          reason: "A plan with authored rows already exists for this month — replacing it needs the explicit button.",
        });
      }
    }

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
          ...(styleCategory !== undefined ? { style_category: styleCategory || null } : {}),
          ...(colorPalette !== undefined ? { color_palette: Array.isArray(colorPalette) && colorPalette.length > 0 ? colorPalette : null } : {}),
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
          ...(styleCategory !== undefined ? { style_category: styleCategory || null } : {}),
          ...(colorPalette !== undefined ? { color_palette: Array.isArray(colorPalette) && colorPalette.length > 0 ? colorPalette : null } : {}),
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
      saved: true,
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
