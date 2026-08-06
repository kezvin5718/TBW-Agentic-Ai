"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtIST } from "@/lib/time";
import { Users, Loader2, Check, X, Shield, KeyRound } from "lucide-react";
import { SECTIONS } from "@/lib/sections";

interface UserRow {
  id: string;
  name: string | null;
  role: string;
  brand_name: string | null;
  approved: boolean;
  permissions: string[] | null;
  created_at: string;
}

const ROLES = ["employee", "founder", "client"];

export default function TeamPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (res.ok) setUsers((await res.json()).users || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (userId: string, action: string, role?: string) => {
    setBusy(userId);
    try {
      await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action, role }) });
      await load();
    } finally { setBusy(null); }
  };

  // Section-permission editing (local draft per user, saved on click)
  const [permDraft, setPermDraft] = useState<Record<string, string[] | null>>({});
  const draftFor = (u: UserRow): string[] | null => (u.id in permDraft ? permDraft[u.id] : u.permissions);
  const togglePerm = (u: UserRow, key: string) => {
    const cur = draftFor(u) ?? SECTIONS.filter((s) => !["onboarding", "agency-brain"].includes(s.key)).map((s) => s.key);
    setPermDraft((p) => ({ ...p, [u.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }));
  };
  const savePerms = async (u: UserRow) => {
    setBusy(u.id);
    try {
      await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id, action: "set_permissions", permissions: draftFor(u) }) });
      setPermDraft((p) => { const n = { ...p }; delete n[u.id]; return n; });
      await load();
    } finally { setBusy(null); }
  };
  const setFullAccess = async (u: UserRow) => {
    setBusy(u.id);
    try {
      await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id, action: "set_permissions", permissions: null }) });
      setPermDraft((p) => { const n = { ...p }; delete n[u.id]; return n; });
      await load();
    } finally { setBusy(null); }
  };

  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved);

  const roleBadge = (r: string) =>
    r === "founder" ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
    : r === "employee" ? "bg-violet-950/40 border-violet-900 text-violet-400"
    : "bg-indigo-950/40 border-indigo-900 text-indigo-400";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Users className="w-6 h-6 text-indigo-400" /><span>Team &amp; Access</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">People who self-register land here for your approval. Approve them and set their role.</p>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : (
        <>
          {/* Pending approvals */}
          <div>
            <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">Pending approval ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="text-xs text-slate-600">No one waiting.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((u) => {
                  const chosen = roleChoice[u.id] || "employee";
                  return (
                    <div key={u.id} className="bg-slate-950/60 border border-amber-900/40 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{u.name || "(no name)"}</p>
                        <p className="text-[10px] text-slate-500">Signed up {fmtIST(u.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select value={chosen} onChange={(e) => setRoleChoice((p) => ({ ...p, [u.id]: e.target.value }))} className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-white focus:outline-none cursor-pointer">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button disabled={!!busy} onClick={() => act(u.id, "approve", chosen)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900 text-emerald-300 hover:bg-emerald-900/40 cursor-pointer flex items-center space-x-1"><Check className="w-3.5 h-3.5" /><span>Approve</span></button>
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            if (window.confirm(`Reject and remove "${u.name || "this user"}"? Their account is deleted — they can sign up again later if needed.`)) {
                              act(u.id, "reject");
                            }
                          }}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 cursor-pointer flex items-center space-x-1"
                        ><X className="w-3.5 h-3.5" /><span>Reject</span></button>
                        {busy === u.id && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active users */}
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Active users ({active.length})</h2>
            <div className="space-y-2">
              {active.map((u) => {
                const d = draftFor(u);
                const dirty = u.id in permDraft;
                return (
                  <div key={u.id} className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex items-center space-x-2">
                        <Shield className="w-4 h-4 text-slate-600 shrink-0" />
                        <p className="text-sm font-bold text-white truncate">{u.name || "(no name)"}{u.brand_name ? <span className="text-slate-500 font-normal"> · {u.brand_name}</span> : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select value={u.role} onChange={(e) => act(u.id, "set_role", e.target.value)} disabled={!!busy} className={`text-[10px] font-bold rounded-lg px-2 py-1 border cursor-pointer focus:outline-none ${roleBadge(u.role)}`}>
                          {ROLES.map((r) => <option key={r} value={r} className="bg-slate-900 text-white">{r}</option>)}
                        </select>
                        <button disabled={!!busy} onClick={() => act(u.id, "revoke")} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-rose-400 cursor-pointer">Revoke</button>
                        {busy === u.id && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                      </div>
                    </div>

                    {/* Section permissions — employees only */}
                    {u.role === "employee" && (
                      <details className="border-t border-slate-900/70 pt-2">
                        <summary className="cursor-pointer text-[11px] font-bold text-slate-400 flex items-center space-x-1.5 list-none">
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>
                            Section access:{" "}
                            {d === null
                              ? <span className="text-emerald-400">Full (default)</span>
                              : <span className="text-amber-400">{d.length} of {SECTIONS.length} sections</span>}
                            {dirty && <span className="text-rose-400"> · unsaved</span>}
                          </span>
                        </summary>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                          {SECTIONS.map((s) => {
                            const list = d ?? SECTIONS.filter((x) => !["onboarding", "agency-brain"].includes(x.key)).map((x) => x.key);
                            const on = list.includes(s.key);
                            return (
                              <label key={s.key} className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-[11px] ${on ? "bg-indigo-950/30 border-indigo-900 text-white" : "bg-slate-950 border-slate-900 text-slate-500"}`}>
                                <input type="checkbox" checked={on} onChange={() => togglePerm(u, s.key)} className="accent-[#FFD400]" />
                                <span><span className="font-bold">{s.num}</span> · {s.name}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button disabled={!!busy || !dirty} onClick={() => savePerms(u)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-40">Save access</button>
                          <button disabled={!!busy} onClick={() => setFullAccess(u)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-700 text-slate-300 cursor-pointer">Give full access</button>
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
