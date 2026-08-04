"use client";

import React, { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";

export interface SnapshotHolding {
  id: string;
  account: string;
  ticker: string;
  name: string;
  unavailable?: boolean;
  price?: number;
  dayPct?: number;
  pnlPct?: number;
  value?: number;
  invested?: number;
  qty?: number;
  avg?: number;
}

export interface AccountSummary {
  account: string;
  value: number;
  cost: number;
  pnlPct: number;
}

interface EditState {
  id?: string;
  account: string;
  ticker: string;
  name: string;
  avg: string;
  qty: string;
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const lakh = (n: number) => `₹${(n / 1e5).toFixed(2)}L`;

function PctBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center space-x-1 text-xs font-bold ${
        up ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      <span>
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}%
      </span>
    </span>
  );
}

export default function HoldingsManager({
  holdings,
  accounts,
  onChanged,
}: {
  holdings: SnapshotHolding[];
  accounts: AccountSummary[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const accountNames = Array.from(new Set(holdings.map((h) => h.account)));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/founder/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          account: editing.account,
          ticker: editing.ticker,
          name: editing.name,
          avg: parseFloat(editing.avg),
          qty: parseFloat(editing.qty),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setEditing(null);
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (h: SnapshotHolding) => {
    if (!window.confirm(`Remove ${h.name} (${h.account}) from the desk?`)) return;
    await fetch("/api/founder/holdings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: h.id }),
    });
    onChanged();
  };

  return (
    <div className="bg-slate-950/60 border border-slate-900 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-900 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-white">Holdings</h2>
          <span className="text-[10px] text-slate-600">
            {holdings.length} scrips · {accountNames.length} accounts
          </span>
        </div>
        <button
          onClick={() =>
            setEditing({ account: accountNames[0] || "Main", ticker: "", name: "", avg: "", qty: "" })
          }
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add holding</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-900">
              <th className="text-left px-5 py-3 font-bold">Stock</th>
              <th className="text-right px-5 py-3 font-bold">Price</th>
              <th className="text-right px-5 py-3 font-bold">Day</th>
              <th className="text-right px-5 py-3 font-bold">Overall</th>
              <th className="text-right px-5 py-3 font-bold">Value</th>
              <th className="text-right px-5 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {accountNames.map((acct) => {
              const rows = holdings.filter((h) => h.account === acct);
              const summary = accounts.find((a) => a.account === acct);
              return (
                <React.Fragment key={acct}>
                  <tr className="bg-slate-900/40 border-b border-slate-900/50">
                    <td colSpan={4} className="px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {acct}
                    </td>
                    <td colSpan={2} className="px-5 py-2 text-right text-[10px] font-bold text-slate-400">
                      {summary && (
                        <>
                          {lakh(summary.value)}{" "}
                          <span className={summary.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}>
                            ({summary.pnlPct >= 0 ? "+" : ""}
                            {summary.pnlPct.toFixed(1)}%)
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                  {rows.map((h) => (
                    <tr
                      key={h.id}
                      className="border-b border-slate-900/50 last:border-0 hover:bg-slate-900/30 group"
                    >
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-200">{h.name}</p>
                        <p className="text-[10px] text-slate-600">
                          {h.ticker}
                          {h.qty ? ` · ${h.qty.toLocaleString("en-IN")} @ ${inr(h.avg!)}` : ""}
                        </p>
                      </td>
                      {h.unavailable ? (
                        <td colSpan={3} className="px-5 py-3 text-right text-xs text-slate-600">
                          price unavailable
                        </td>
                      ) : (
                        <>
                          <td className="px-5 py-3 text-right font-semibold text-white">
                            {inr(h.price!)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <PctBadge value={h.dayPct!} />
                          </td>
                          <td className="px-5 py-3 text-right">
                            <PctBadge value={h.pnlPct!} />
                          </td>
                        </>
                      )}
                      <td className="px-5 py-3 text-right text-slate-300">
                        {h.value != null ? lakh(h.value) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() =>
                            setEditing({
                              id: h.id,
                              account: h.account,
                              ticker: h.ticker,
                              name: h.name,
                              avg: String(h.avg ?? ""),
                              qty: String(h.qty ?? ""),
                            })
                          }
                          className="p-1.5 rounded-lg text-slate-600 hover:text-white hover:bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => remove(h)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editing.id ? "Edit Holding" : "Add Holding"}
              </h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Account
              </label>
              <input
                list="fz-accounts"
                value={editing.account}
                onChange={(e) => setEditing((v) => v && { ...v, account: e.target.value })}
                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-800/60"
              />
              <datalist id="fz-accounts">
                {accountNames.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            {[
              { key: "name" as const, label: "Company name", ph: "e.g. Tata Power" },
              { key: "ticker" as const, label: "Yahoo ticker (.NS / .BO)", ph: "e.g. TATAPOWER.NS" },
              { key: "avg" as const, label: "Average buy price (₹)", ph: "e.g. 482.82" },
              { key: "qty" as const, label: "Quantity", ph: "e.g. 350" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  {f.label}
                </label>
                <input
                  value={editing[f.key]}
                  onChange={(e) => setEditing((v) => v && { ...v, [f.key]: e.target.value })}
                  placeholder={f.ph}
                  className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-800/60"
                />
              </div>
            ))}

            {formError && (
              <div className="flex items-start space-x-2 bg-red-950/30 border border-red-900/50 rounded-xl p-3 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <button
              onClick={save}
              disabled={saving || !editing.ticker.trim() || !editing.account.trim()}
              className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-sm font-semibold text-emerald-300 hover:text-white hover:border-emerald-700 transition-all disabled:opacity-40"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? "Verifying ticker…" : "Save Holding"}</span>
            </button>
            <p className="text-[10px] text-slate-600 text-center">
              The ticker is checked against a live price before saving — typos are rejected.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
