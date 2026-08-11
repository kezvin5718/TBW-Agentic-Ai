import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ACCOUNTING_COOKIE, verifyAccountingToken } from "@/lib/accounting-lock";

export const dynamic = "force-dynamic";

async function requireUnlockedFounder(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user) return { error: NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 }) };
  if (role !== "founder") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const token = request.cookies.get(ACCOUNTING_COOKIE)?.value;
  if (!verifyAccountingToken(token)) return { error: NextResponse.json({ error: "locked" }, { status: 401 }) };
  return { user };
}

/** GET — everything the desk shows: dues, expenses, and the balance they add up to. */
export async function GET(request: NextRequest) {
  const guard = await requireUnlockedFounder(request);
  if (guard.error) return guard.error;

  const admin = createServiceRoleClient();
  const [{ data: dues, error: duesErr }, { data: expenses, error: expErr }] = await Promise.all([
    admin.from("client_dues").select("*").order("due_date", { ascending: true }),
    admin.from("accounting_expenses").select("*").order("expense_date", { ascending: false }),
  ]);
  if (duesErr) return NextResponse.json({ error: duesErr.message }, { status: 500 });
  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const pending = (dues || []).filter((d) => d.status === "pending");
  const overdue = pending.filter((d) => d.due_date < today);
  const upcoming = pending.filter((d) => d.due_date >= today && d.due_date <= addDays(today, 30));

  const totalPending = pending.reduce((n, d) => n + Number(d.amount), 0);
  const totalCollected = (dues || []).filter((d) => d.status === "paid").reduce((n, d) => n + Number(d.amount), 0);
  const totalExpenses = (expenses || []).reduce((n, e) => n + Number(e.amount), 0);

  return NextResponse.json({
    success: true,
    dues: dues || [],
    expenses: expenses || [],
    summary: {
      totalPending,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((n, d) => n + Number(d.amount), 0),
      upcomingCount: upcoming.length,
      totalCollected,
      totalExpenses,
      balance: totalCollected - totalExpenses,
    },
  });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * POST — every write this desk needs, dispatched by action:
 *  add_due, mark_due_paid, mark_due_pending, delete_due,
 *  add_expense, delete_expense, lock (clears the unlock cookie).
 */
export async function POST(request: NextRequest) {
  const guard = await requireUnlockedFounder(request);
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => ({}));
  const admin = createServiceRoleClient();

  if (body.action === "lock") {
    const res = NextResponse.json({ success: true });
    res.cookies.set(ACCOUNTING_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  if (body.action === "add_due") {
    const amount = Number(body.amount);
    const dueDate = String(body.dueDate || "");
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "Give a valid amount." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NextResponse.json({ error: "Give a valid due date." }, { status: 400 });
    const { error } = await admin.from("client_dues").insert({
      client_id: body.clientId || null,
      client_name: String(body.clientName || "").trim() || null,
      kind: ["retainer", "renewal", "one_off"].includes(body.kind) ? body.kind : "retainer",
      amount,
      due_date: dueDate,
      notes: String(body.notes || "").trim() || null,
      created_by: guard.user!.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "mark_due_paid" || body.action === "mark_due_pending") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const paid = body.action === "mark_due_paid";
    const { error } = await admin
      .from("client_dues")
      .update({ status: paid ? "paid" : "pending", paid_date: paid ? new Date().toISOString().slice(0, 10) : null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "delete_due") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const { error } = await admin.from("client_dues").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "add_expense") {
    const amount = Number(body.amount);
    const category = String(body.category || "");
    const validCategories = ["salary", "credit_card", "utility_water", "utility_electricity", "rent", "other"];
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: "Give a valid amount." }, { status: 400 });
    if (!validCategories.includes(category)) return NextResponse.json({ error: "Give a valid category." }, { status: 400 });
    const { error } = await admin.from("accounting_expenses").insert({
      category,
      description: String(body.description || "").trim() || null,
      amount,
      expense_date: /^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate) ? body.expenseDate : new Date().toISOString().slice(0, 10),
      notes: String(body.notes || "").trim() || null,
      created_by: guard.user!.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "delete_expense") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const { error } = await admin.from("accounting_expenses").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
