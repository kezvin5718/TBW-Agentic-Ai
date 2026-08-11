"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  ArrowLeft,
  IndianRupee,
  Receipt,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";

interface Due {
  id: string;
  client_id: string | null;
  client_name: string | null;
  kind: "retainer" | "renewal" | "one_off";
  amount: number;
  due_date: string;
  status: "pending" | "paid";
  paid_date: string | null;
  notes: string | null;
}

interface Expense {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  expense_date: string;
  notes: string | null;
}

interface Summary {
  totalPending: number;
  overdueCount: number;
  overdueAmount: number;
  upcomingCount: number;
  totalCollected: number;
  totalExpenses: number;
  balance: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  salary: "Salary",
  credit_card: "Credit Card Bill",
  utility_water: "Utility — Water",
  utility_electricity: "Utility — Electricity",
  rent: "Rent",
  other: "Other / Misc",
};

const KIND_LABEL: Record<string, string> = {
  retainer: "Retainer / Monthly Bill",
  renewal: "Renewal",
  one_off: "One-off",
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);

export default function AccountingPage() {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dues, setDues] = useState<Due[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  const [showAddDue, setShowAddDue] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/founder/accounting");
      if (res.status === 403) {
        setForbidden(true);
        setLocked(false);
        return;
      }
      if (res.status === 401) {
        const j = await res.json().catch(() => ({}));
        if (j.error === "locked") {
          setLocked(true);
          return;
        }
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setDues(json.dues || []);
      setExpenses(json.expenses || []);
      setSummary(json.summary || null);
      setLocked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the ledger.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (locked === false && clients.length === 0) {
      const supabase = createClient();
      supabase
        .from("clients")
        .select("id, name")
        .is("archived_at", null)
        .order("name")
        .then(({ data }) => setClients(data || []));
    }
  }, [locked, clients.length]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError("");
    try {
      const res = await fetch("/api/founder/accounting/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setUnlockError(json.error || "Wrong password.");
        return;
      }
      setPassword("");
      await load();
    } catch {
      setUnlockError("Could not reach the server.");
    } finally {
      setUnlocking(false);
    }
  }

  async function lockAgain() {
    await fetch("/api/founder/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lock" }),
    });
    setLocked(true);
    setDues([]);
    setExpenses([]);
    setSummary(null);
  }

  async function toggleDuePaid(due: Due) {
    await fetch("/api/founder/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: due.status === "paid" ? "mark_due_pending" : "mark_due_paid", id: due.id }),
    });
    load();
  }

  async function deleteDue(id: string) {
    if (!confirm("Remove this due entry?")) return;
    await fetch("/api/founder/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_due", id }),
    });
    load();
  }

  async function deleteExpense(id: string) {
    if (!confirm("Remove this expense entry?")) return;
    await fetch("/api/founder/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_expense", id }),
    });
    load();
  }

  if (locked === null || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-3" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-3">
        <Lock className="w-10 h-10 text-slate-600 mx-auto" />
        <p className="text-slate-400 font-semibold">Founder access only</p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="max-w-sm mx-auto mt-24">
        <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-8 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-indigo-950/40 border border-indigo-800/50 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Accounting</h1>
            <p className="text-xs text-slate-500 mt-1">Founder-only. Enter the passcode to continue.</p>
          </div>
          <form onSubmit={unlock} className="space-y-3">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passcode"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white text-center tracking-wide focus:outline-none focus:border-indigo-700"
            />
            {unlockError && <p className="text-xs text-red-400">{unlockError}</p>}
            <button
              type="submit"
              disabled={unlocking || !password}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white disabled:opacity-50"
            >
              {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
              <span>Unlock</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="inline-flex items-center space-x-1 text-xs text-slate-500 hover:text-slate-300 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/40 border border-indigo-800/50 flex items-center justify-center">
              <IndianRupee className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Accounting</h1>
              <p className="text-xs text-slate-500">Your own tracker — client dues, renewals, and expense entries. Not the accountant&apos;s books.</p>
            </div>
          </div>
        </div>
        <button
          onClick={lockAgain}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400 hover:text-white hover:border-slate-700"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Lock</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center space-x-2 bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Pending Dues" value={inr(summary.totalPending)} sub={`${dues.filter((d) => d.status === "pending").length} entr${dues.filter((d) => d.status === "pending").length === 1 ? "y" : "ies"}`} tone="amber" />
          <SummaryCard label="Overdue" value={inr(summary.overdueAmount)} sub={`${summary.overdueCount} due date${summary.overdueCount === 1 ? "" : "s"} passed`} tone="red" />
          <SummaryCard label="Due in 30 days" value={String(summary.upcomingCount)} sub="upcoming reminders" tone="indigo" />
          <SummaryCard label="Balance" value={inr(summary.balance)} sub={`collected ${inr(summary.totalCollected)} · spent ${inr(summary.totalExpenses)}`} tone={summary.balance >= 0 ? "emerald" : "red"} />
        </div>
      )}

      {/* Client dues */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CalendarClock className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">Client Dues &amp; Renewals</h2>
          </div>
          <button
            onClick={() => setShowAddDue((v) => !v)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add due</span>
          </button>
        </div>

        {showAddDue && (
          <AddDueForm
            clients={clients}
            onCancel={() => setShowAddDue(false)}
            onAdded={() => {
              setShowAddDue(false);
              load();
            }}
          />
        )}

        <div className="divide-y divide-slate-900/50">
          {dues.length === 0 && <p className="px-5 py-6 text-xs text-slate-600">No dues recorded yet.</p>}
          {dues.map((d) => {
            const overdue = d.status === "pending" && d.due_date < today();
            return (
              <div key={d.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <button onClick={() => toggleDuePaid(d)} className="shrink-0" title={d.status === "paid" ? "Mark pending" : "Mark paid"}>
                  {d.status === "paid" ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className={`w-5 h-5 ${overdue ? "text-red-500" : "text-slate-600"}`} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200 truncate">
                    {d.client_name || "—"} <span className="text-slate-600 font-normal">· {KIND_LABEL[d.kind]}</span>
                  </p>
                  <p className={`text-[11px] mt-0.5 ${overdue ? "text-red-400" : "text-slate-500"}`}>
                    {d.status === "paid" ? `paid ${d.paid_date}` : overdue ? `overdue — was due ${d.due_date}` : `due ${d.due_date}`}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold text-white shrink-0">{inr(Number(d.amount))}</p>
                <button onClick={() => deleteDue(d.id)} className="text-slate-700 hover:text-red-400 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expenses */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white">Expenses</h2>
          </div>
          <button
            onClick={() => setShowAddExpense((v) => !v)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add expense</span>
          </button>
        </div>

        {showAddExpense && (
          <AddExpenseForm
            onCancel={() => setShowAddExpense(false)}
            onAdded={() => {
              setShowAddExpense(false);
              load();
            }}
          />
        )}

        <div className="divide-y divide-slate-900/50">
          {expenses.length === 0 && <p className="px-5 py-6 text-xs text-slate-600">No expenses recorded yet.</p>}
          {expenses.map((e) => (
            <div key={e.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-200 truncate">
                  {CATEGORY_LABEL[e.category] || e.category}
                  {e.description ? <span className="text-slate-500 font-normal"> · {e.description}</span> : null}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{e.expense_date}{e.notes ? ` · ${e.notes}` : ""}</p>
              </div>
              <p className="text-sm font-bold text-white shrink-0">{inr(Number(e.amount))}</p>
              <button onClick={() => deleteExpense(e.id)} className="text-slate-700 hover:text-red-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-600 text-center pb-4 flex items-center justify-center gap-1.5">
        <AlertTriangle className="w-3 h-3" />
        Manual entries for your own visibility — actual billing stays with the accountant.
      </p>
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "amber" | "red" | "indigo" | "emerald" }) {
  const toneClass = { amber: "text-amber-400", red: "text-red-400", indigo: "text-indigo-400", emerald: "text-emerald-400" }[tone];
  return (
    <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

function AddDueForm({
  clients,
  onCancel,
  onAdded,
}: {
  clients: { id: string; name: string }[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [kind, setKind] = useState("retainer");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/founder/accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_due",
          clientId: clientId || null,
          clientName: clientId ? clients.find((c) => c.id === clientId)?.name : clientName,
          kind,
          amount: Number(amount),
          dueDate,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || "Could not save.");
        return;
      }
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="px-5 py-4 border-b border-slate-900 bg-slate-900/30 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        >
          <option value="">— pick a client (or type below) —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Or type a client / party name"
          disabled={!!clientId}
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white disabled:opacity-40"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white">
          <option value="retainer">Retainer / Monthly Bill</option>
          <option value="renewal">Renewal</option>
          <option value="one_off">One-off</option>
        </select>
        <input
          type="number"
          min="0"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (₹)"
          required
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          required
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex items-center space-x-2">
        <button type="submit" disabled={saving || !amount || !dueDate} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save due"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddExpenseForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  const [category, setCategory] = useState("salary");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/founder/accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_expense", category, description, amount: Number(amount), expenseDate, notes }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || "Could not save.");
        return;
      }
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="px-5 py-4 border-b border-slate-900 bg-slate-900/30 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white">
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (e.g. team salaries, Aug)"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
        <input
          type="number"
          min="0"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (₹)"
          required
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
        <input
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          required
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white md:col-span-2"
        />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex items-center space-x-2">
        <button type="submit" disabled={saving || !amount} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save expense"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  );
}
