import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestAssignee } from "@/lib/task-router";

export const dynamic = "force-dynamic";

/**
 * GET /api/task-router?clientId=&taskType=
 *
 * Who the history says should do this. A thin wrapper so the boards can ask,
 * and so the answer can be checked by hand from a browser before anything is
 * wired to it. Both parameters are optional — the router copes with either one
 * missing, and answers with null when it cannot honestly name anybody.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const suggestion = await suggestAssignee({
    clientId: params.get("clientId"),
    taskType: params.get("taskType"),
  });

  return NextResponse.json({ success: true, suggestion });
}
