"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight, UserCheck, TrendingUp, Archive, RotateCcw,
  Trash2, Loader2, AlertTriangle, X,
} from "lucide-react";

export type ClientRow = {
  id: string;
  name: string;
  logo_url: string | null;
  deliverables_per_month: number | null;
  ad_budget: number | null;
  archived_at: string | null;
};

type Impact = { destroyed: Record<string, number>; detached: Record<string, number> };

export default function ClientGrid({
  clients,
  isFounder,
  attached,
  lookAlikes,
}: {
  clients: ClientRow[];
  isFounder: boolean;
  attached: Record<string, number>;
  lookAlikes: string[][];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showDupes, setShowDupes] = useState(false);

  const byId = new Map(clients.map((c) => [c.id, c]));
  const isEmpty = (id: string) => (attached[id] || 0) === 0;

  // Permanent-delete dialog state.
  const [victim, setVictim] = useState<ClientRow | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const active = clients.filter((c) => !c.archived_at);
  const archived = clients.filter((c) => c.archived_at);

  const setArchived = async (client: ClientRow, action: "archive" | "restore") => {
    setBusy(client.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNotice({ ok: true, text: data.message });
      if (action === "restore") setShowArchived(true);
      router.refresh();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  /** Nothing is attached, so there is nothing to preview or type back. */
  const deleteEmpty = async (client: ClientRow) => {
    if (!confirm(`Delete "${client.name}"? Nothing is attached to it, so nothing else is lost.`)) return;
    setBusy(client.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNotice({ ok: true, text: data.message });
      router.refresh();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const openDelete = async (client: ClientRow) => {
    setVictim(client);
    setTyped("");
    setImpact(null);
    setImpactError(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read what is attached.");
      setImpact({ destroyed: data.destroyed || {}, detached: data.detached || {} });
    } catch (err: unknown) {
      setImpactError(err instanceof Error ? err.message : "Could not read what is attached.");
    }
  };

  const confirmDelete = async () => {
    if (!victim) return;
    setBusy(victim.id);
    try {
      const res = await fetch(`/api/clients/${victim.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNotice({ ok: true, text: data.message });
      setVictim(null);
      router.refresh();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const nameMatches = victim ? typed.trim().toLowerCase() === victim.name.trim().toLowerCase() : false;

  return (
    <div className="space-y-6">
      {notice && (
        <div
          className={`flex items-start gap-2 p-3 rounded-xl border text-xs ${
            notice.ok
              ? "bg-emerald-950/20 border-emerald-900/50 text-emerald-200"
              : "bg-red-950/20 border-red-900/50 text-red-200"
          }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {lookAlikes.length > 0 && (
        <div className="border border-amber-900/40 bg-amber-950/10 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowDupes((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-amber-950/20 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              {lookAlikes.length} set{lookAlikes.length === 1 ? "" : "s"} of similar names — possible duplicates
            </span>
            <ChevronRight className={`w-4 h-4 text-amber-700 transition-transform ${showDupes ? "rotate-90" : ""}`} />
          </button>

          {showDupes && (
            <div className="px-5 pb-4 space-y-3">
              <p className="text-[11px] text-slate-500">
                These names resemble each other. Some are genuinely separate accounts — check before removing anything.
              </p>
              {lookAlikes.map((group, i) => (
                <div key={i} className="rounded-xl border border-slate-900 bg-slate-950/60 divide-y divide-slate-900">
                  {group.map((id) => {
                    const c = byId.get(id);
                    if (!c) return null;
                    const n = attached[id] || 0;
                    return (
                      <div key={id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/brand-brain/${id}`}
                            className="text-xs font-semibold text-slate-300 hover:text-indigo-400 transition-colors"
                          >
                            {c.name}
                          </Link>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            {n === 0 ? "nothing attached" : `${n} linked record${n === 1 ? "" : "s"}`}
                          </p>
                        </div>
                        {isFounder && n === 0 && (
                          <button
                            onClick={() => deleteEmpty(c)}
                            disabled={busy === id}
                            className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-red-300 border border-slate-800 hover:border-red-900 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            {busy === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Delete
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {active.map((client) => (
          <div
            key={client.id}
            className="group bg-slate-950/40 border border-slate-900 hover:border-slate-800 rounded-2xl transition-all relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 left-0 h-[1.5px] bg-gradient-to-r from-transparent via-indigo-500/0 group-hover:via-indigo-500/20 to-transparent transition-all" />
            <Link href={`/dashboard/brand-brain/${client.id}`} className="block p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-900/50 flex items-center justify-center text-indigo-400 font-bold text-xs uppercase">
                      {client.name.substring(0, 2)}
                    </div>
                    <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors text-sm">{client.name}</h3>
                  </div>
                  <div className="flex items-center space-x-4 text-[10px] text-slate-500">
                    <div className="flex items-center space-x-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{client.deliverables_per_month} ads/mo</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>Budget: INR {client.ad_budget?.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                </div>
                <div className="w-7 h-7 rounded-lg border border-slate-900 group-hover:border-slate-800 bg-slate-950 flex items-center justify-center text-slate-500 group-hover:text-indigo-400 transition-all">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
            <div className="px-5 pb-4 -mt-1 flex items-center gap-4">
              <button
                onClick={() => setArchived(client, "archive")}
                disabled={busy === client.id}
                title="Hide this client everywhere. Nothing is deleted and you can restore it any time."
                className="inline-flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-amber-300 transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy === client.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                <span>Archive</span>
              </button>
              {isFounder && isEmpty(client.id) && (
                <button
                  onClick={() => deleteEmpty(client)}
                  disabled={busy === client.id}
                  title="Nothing is attached to this client — safe to delete outright."
                  className="inline-flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              )}
              {!isEmpty(client.id) && (
                <span className="text-[10px] text-slate-700">{attached[client.id]} linked records</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div className="border border-slate-900 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 bg-slate-950/40 hover:bg-slate-950/70 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <Archive className="w-3.5 h-3.5" />
              Archived ({archived.length})
            </span>
            <ChevronRight className={`w-4 h-4 text-slate-600 transition-transform ${showArchived ? "rotate-90" : ""}`} />
          </button>

          {showArchived && (
            <div className="divide-y divide-slate-900">
              {archived.map((client) => (
                <div key={client.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/brand-brain/${client.id}`}
                      className="text-sm font-semibold text-slate-400 hover:text-indigo-400 transition-colors truncate block"
                    >
                      {client.name}
                    </Link>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      Hidden from all lists — history kept
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setArchived(client, "restore")}
                      disabled={busy === client.id}
                      className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-emerald-300 border border-slate-800 hover:border-emerald-900 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {busy === client.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Restore
                    </button>
                    {isFounder && (
                      <button
                        onClick={() => openDelete(client)}
                        className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-red-300 border border-slate-800 hover:border-red-900 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete forever
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {victim && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-red-900/60 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Delete {victim.name} permanently?</h3>
                <p className="text-xs text-slate-500 mt-1">This cannot be undone.</p>
              </div>
            </div>

            {impactError ? (
              <p className="text-xs text-red-300 rounded-xl border border-red-900/40 bg-red-950/10 p-3">
                Couldn&apos;t check what this would remove — {impactError} Deleting blind is not worth the risk; close this and try again.
              </p>
            ) : impact === null ? (
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking what this would remove…
              </p>
            ) : (
              <div className="space-y-3">
                {Object.keys(impact.destroyed).length === 0 && Object.keys(impact.detached).length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Nothing is attached to this client — deleting it removes only the client record itself.
                  </p>
                ) : (
                  <>
                    {Object.keys(impact.destroyed).length > 0 && (
                      <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-3">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-red-300 mb-2">
                          Permanently deleted
                        </p>
                        <ul className="space-y-1">
                          {Object.entries(impact.destroyed).map(([label, n]) => (
                            <li key={label} className="text-xs text-slate-300 flex justify-between gap-4">
                              <span>{label}</span>
                              <span className="font-semibold text-red-300">{n}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Object.keys(impact.detached).length > 0 && (
                      <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-3">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-300 mb-2">
                          Kept, but no longer linked to any client
                        </p>
                        <ul className="space-y-1">
                          {Object.entries(impact.detached).map(([label, n]) => (
                            <li key={label} className="text-xs text-slate-300 flex justify-between gap-4">
                              <span>{label}</span>
                              <span className="font-semibold text-amber-300">{n}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
                Type <span className="text-slate-300">{victim.name}</span> to confirm
              </label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-700 focus:outline-none focus:border-red-700"
                placeholder={victim.name}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setVictim(null)}
                className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              >
                Keep it
              </button>
              <button
                onClick={confirmDelete}
                disabled={!nameMatches || busy === victim.id || !!impactError}
                className="inline-flex items-center gap-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-600 disabled:bg-slate-900 disabled:text-slate-600 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                {busy === victim.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
