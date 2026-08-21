import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * DELETE — remove a monthly plan. Founder-only.
 *
 * A junk plan that cannot be deleted keeps resurfacing as if it were real —
 * the Shwetanki filler sat for twelve days telling everyone who opened 5b
 * that the month was thirty copies of the same post. Deleting detaches
 * rather than destroys: creatives already generated stay in Creative
 * Approvals and on Drive, they just lose the link to the dead plan. Only
 * the plan's own rows (its calendar and its product-photo list) go with it.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  if (role !== "founder") {
    return NextResponse.json({ error: "Only the founder can delete a monthly plan." }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data: plan } = await admin
    .from("monthly_plans")
    .select("id, month, clients(name)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Detach everything that points at the plan, then remove it. Order matters:
  // a foreign key would otherwise block the delete outright.
  const { count: creativeCount } = await admin
    .from("creatives").select("*", { count: "exact", head: true }).eq("plan_id", id);
  await admin.from("creatives").update({ plan_id: null }).eq("plan_id", id);
  await admin.from("tasks").update({ plan_id: null }).eq("plan_id", id);
  await admin.from("plan_product_photos").delete().eq("plan_id", id);

  const { error } = await admin.from("monthly_plans").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientName = (plan.clients as { name?: string } | null)?.name || "the client";
  const monthLabel = new Date(plan.month as string).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return NextResponse.json({
    success: true,
    message: `${clientName}'s ${monthLabel} plan is deleted.${creativeCount ? ` ${creativeCount} creative(s) built from it stay in Creative Approvals, no longer linked to a plan.` : ""}`,
  });
}
