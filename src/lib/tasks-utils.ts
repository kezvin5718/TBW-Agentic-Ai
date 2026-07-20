import { createServiceRoleClient } from "@/lib/supabase/server";

export async function generateTasksForPlan(planId: string) {
  const supabase = createServiceRoleClient();

  // 1. Fetch the plan
  const { data: plan, error: planErr } = await supabase
    .from("monthly_plans")
    .select("*, clients(name)")
    .eq("id", planId)
    .single();

  if (planErr || !plan) {
    console.error("Failed to fetch plan for task generation:", planErr);
    return { success: false, error: planErr?.message || "Plan not found" };
  }

  const calendar = plan.content_calendar as Array<{
    date: string;
    format: string;
    concept: string;
    hook?: string;
    cta?: string;
  }> | null;

  if (!calendar || calendar.length === 0) {
    return { success: true, count: 0, message: "No content calendar items found to generate tasks." };
  }

  // 2. Fetch default assignee settings
  const { data: settingsRow } = await supabase
    .from("agency_settings")
    .select("value")
    .eq("key", "default_assignees")
    .maybeSingle();

  const defaultAssignees = (settingsRow?.value || {}) as Record<string, string | null>;

  // 3. Process calendar slots and construct tasks list
  const tasksToInsert = [];
  for (const item of calendar) {
    const postDate = new Date(item.date);
    
    // Deadline = post date minus 3 days
    const deadlineDate = new Date(postDate);
    deadlineDate.setDate(deadlineDate.getDate() - 3);

    // Map format to task type
    const formatLower = (item.format || "").toLowerCase();
    let taskType: "copy" | "image" | "video" = "copy";
    if (["reel", "video", "youtube_short", "shorts", "tiktok"].includes(formatLower)) {
      taskType = "video";
    } else if (["image", "static", "carousel", "graphic", "photo"].includes(formatLower)) {
      taskType = "image";
    }

    // Resolve assignee
    const assigneeId = defaultAssignees[taskType] || null;

    tasksToInsert.push({
      plan_id: planId,
      type: taskType,
      deadline: deadlineDate.toISOString(),
      assignee_id: assigneeId,
      priority: "medium",
      status: "todo",
      metadata: {
        format: item.format,
        concept: item.concept,
        hook: item.hook || "",
        cta: item.cta || "",
      },
    });
  }

  // 4. Insert tasks into DB
  if (tasksToInsert.length > 0) {
    const { error: insertErr } = await supabase.from("tasks").insert(tasksToInsert);
    if (insertErr) {
      console.error("Failed to insert generated tasks:", insertErr);
      return { success: false, error: insertErr.message };
    }
  }

  return {
    success: true,
    count: tasksToInsert.length,
    message: `Generated ${tasksToInsert.length} tasks from monthly plan content calendar.`,
  };
}
