import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Stage B of the AI Project Manager: tasks that assign themselves.
 *
 * Off by default and only ever acting on a HIGH-confidence read of the
 * history — anything less stays unassigned for a person to decide, which is
 * the same behaviour as Stage A. The switch is the only difference.
 *
 * Every assignment it does make is written to the managers' ledger, so the
 * founder reads it in tomorrow's brief rather than discovering months later
 * that something had been quietly handing out work.
 */

export const PM_AUTO_ASSIGN_KEY = "pm_auto_assign";

/** Absent means off. A missing setting must never be read as permission. */
export async function isAutoAssignOn(): Promise<boolean> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.from("agency_settings").select("value").eq("key", PM_AUTO_ASSIGN_KEY).maybeSingle();
    const value = data?.value as { state?: string } | string | null;
    const state = typeof value === "string" ? value : value?.state;
    return String(state || "off").toLowerCase() === "on";
  } catch {
    return false;
  }
}

/** Who the PM put on a task, for callers that keep their own copy of it. */
export interface AutoAssigned { teamMemberId: string | null; profileId: string | null; name: string }

/**
 * Assign a freshly created task, but only if the switch is on and the router
 * is sure. Answers who it assigned, or null when it left the task alone.
 *
 * Nothing in here may throw: a task that was just created successfully must
 * not fail because the routing was unavailable.
 */
export async function autoAssignTask(input: {
  taskId: string;
  title: string;
  clientId?: string | null;
  taskType?: string | null;
}): Promise<AutoAssigned | null> {
  try {
    if (!(await isAutoAssignOn())) return null;

    const { suggestAssignee } = await import("@/lib/task-router");
    const pick = await suggestAssignee({ clientId: input.clientId, taskType: input.taskType });
    // Only certainty acts. A medium guess is exactly the thing a person should
    // be looking at, not the thing a machine should be doing behind them.
    if (!pick || pick.confidence !== "high") return null;

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("tasks")
      .update({ assignee_name: pick.name, assignee_id: pick.profileId })
      .eq("id", input.taskId);
    if (error) return null;

    // The receipt. The next morning scan will not emit this key, so the ledger
    // marks it fixed and it surfaces once under the brief's FIXED section —
    // a record that reads itself out and then gets out of the way.
    try {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      await admin.from("manager_issues").insert({
        key: `pm_auto:${input.taskId}`,
        manager: "social",
        title: `PM assigned: ${input.title.slice(0, 120)} → ${pick.name}`,
        status: "open",
        first_seen: today,
        last_seen: today,
        times_seen: 1,
      });
    } catch { /* the assignment stands even if the receipt fails */ }

    return { teamMemberId: pick.teamMemberId, profileId: pick.profileId, name: pick.name };
  } catch {
    return null;
  }
}
