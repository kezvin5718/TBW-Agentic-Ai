/**
 * The client's way of asking who should do a piece of work.
 *
 * The scoring lives on the server and stays there — this only carries the
 * question and the answer. Every surface keeps its own cache of answers,
 * because the same (client, type) pair is asked about over and over as a
 * founder works down a list.
 */

export interface RouteSuggestion {
  teamMemberId: string | null;
  profileId: string | null;
  name: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  alternates: { name: string; reason: string }[];
}

/** One cache entry per question asked. */
export function suggestionKey(clientId?: string | null, taskType?: string | null): string {
  return `${clientId || ""}|${taskType || ""}`;
}

/**
 * Ask the router. A refusal, an outage or a 403 all answer null — every caller
 * then behaves exactly as it did before any of this existed.
 */
export async function fetchSuggestion(
  clientId?: string | null,
  taskType?: string | null
): Promise<RouteSuggestion | null> {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  if (taskType) params.set("taskType", taskType);
  try {
    const res = await fetch(`/api/task-router?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).suggestion || null;
  } catch {
    return null;
  }
}
