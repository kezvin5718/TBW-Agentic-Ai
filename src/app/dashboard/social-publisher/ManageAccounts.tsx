"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import PlatformIcon, { PLATFORM_LABEL } from "./PlatformIcon";

interface Account { id: string; name: string; platform: string; typeLabel?: string; connected?: boolean }
type Mapping = Record<string, { client_id: string; platform: string }>;

/** The four the team posts to, first and in this order; anything else RecurPost holds follows. */
const MAIN_PLATFORMS = ["instagram", "facebook", "youtube", "pinterest"];
const label = (p: string) => PLATFORM_LABEL[p] || (p ? p[0].toUpperCase() + p.slice(1) : "Other");

/** Words that say nothing about WHICH client an account belongs to. */
const GENERIC = new Set(["jewellers", "jewellery", "jewels", "jewel", "jewelers", "jewelry", "gold", "the", "and", "shri", "shree", "sri"]);

/**
 * Manage accounts — every social account RecurPost holds, and which client
 * each one posts for.
 *
 * A client can have more than one account on a platform (two Instagram
 * profiles, say) and a post goes to every one of them, so connecting is one
 * click per account rather than one slot per platform. Refresh asks RecurPost
 * again there and then: an account added in RecurPost a minute ago shows up
 * without reloading the page.
 *
 * Each click changes one account on the server. Nothing here saves "the whole
 * list", so two people connecting accounts at once cannot undo each other.
 */
export default function ManageAccounts({
  open, onClose, clients, initialClientId, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  clients: Array<{ id: string; name: string }>;
  initialClientId: string;
  /** Called with the saved mapping after every connect / disconnect. */
  onChanged: (mapping: Mapping) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [clientId, setClientId] = useState(initialClientId);
  const [platform, setPlatform] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recurpost/accounts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the accounts");
      if (data.configured === false) throw new Error("RecurPost is not set up on the server yet.");
      setAccounts(data.accounts || []);
      setMapping(data.mapping || {});
      setRefreshedAt(new Date());
      // The list came back empty WITH a reason: say it rather than show "no accounts".
      if (data.error) setError(`RecurPost: ${data.error}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the accounts");
    } finally { setLoading(false); }
  }, []);

  // Opening the popup is itself a refresh — it never shows a list from earlier.
  useEffect(() => {
    if (!open) return;
    setClientId(initialClientId);
    setSearch("");
    setPlatform("all");
    void refresh();
  }, [open, initialClientId, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const clientName = useCallback((id: string) => clients.find((c) => c.id === id)?.name || "another client", [clients]);
  const selected = clients.find((c) => c.id === clientId);
  const platformOf = useCallback((a: Account) => mapping[a.id]?.platform || a.platform || "", [mapping]);

  const change = async (a: Account, action: "connect" | "disconnect", move = false) => {
    setBusyId(a.id);
    setError(null);
    try {
      const res = await fetch("/api/recurpost/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId: a.id, clientId, platform: a.platform, move }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setMapping(data.mapping || {});
      onChanged(data.mapping || {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally { setBusyId(null); }
  };

  const platformChips = useMemo(() => {
    const present = new Set(accounts.map(platformOf).filter(Boolean));
    return [...MAIN_PLATFORMS.filter((p) => present.has(p)), ...[...present].filter((p) => !MAIN_PLATFORMS.includes(p)).sort()];
  }, [accounts, platformOf]);

  /** This client's accounts per platform — the line that shows "Instagram 2". */
  const mineByPlatform = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of accounts) {
      if (clientId && mapping[a.id]?.client_id === clientId) out[platformOf(a)] = (out[platformOf(a)] || 0) + 1;
    }
    return out;
  }, [accounts, mapping, clientId, platformOf]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tokens = (selected?.name || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !GENERIC.has(t));
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return accounts
      .filter((a) => platform === "all" || platformOf(a) === platform)
      .filter((a) => {
        if (!q) return true;
        const owner = mapping[a.id]?.client_id ? clientName(mapping[a.id].client_id).toLowerCase() : "";
        return a.name.toLowerCase().includes(q) || owner.includes(q);
      })
      .map((a) => {
        const owner = mapping[a.id]?.client_id || "";
        const mine = !!clientId && owner === clientId;
        const looksLikeIt = !owner && tokens.some((t) => squash(a.name).includes(t));
        // This client's own first, then likely matches, then other free accounts, then other clients'.
        const rank = mine ? 0 : looksLikeIt ? 1 : !owner ? 2 : 3;
        return { a, owner, mine, looksLikeIt, rank };
      })
      .sort((x, y) => x.rank - y.rank || MAIN_PLATFORMS.indexOf(platformOf(x.a)) - MAIN_PLATFORMS.indexOf(platformOf(y.a)) || x.a.name.localeCompare(y.a.name));
  }, [accounts, mapping, platform, search, clientId, selected, clientName, platformOf]);

  if (!open) return null;

  const unconnected = accounts.filter((a) => !mapping[a.id]?.client_id).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Manage accounts"
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-slate-900">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white">Manage accounts</h2>
            <p className="text-sm text-slate-400 mt-1">
              Connect each client&apos;s social accounts. A client can have more than one account on a platform — a post goes to all of them.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={refresh} disabled={loading}
              title="Ask RecurPost for its account list again — picks up accounts added there just now"
              className="h-10 px-3.5 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-200 hover:border-indigo-600 hover:text-white cursor-pointer disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>{loading ? "Refreshing…" : "Refresh"}</span>
            </button>
            <button onClick={onClose} aria-label="Close" className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3 border-b border-slate-900">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold text-slate-300 block mb-1.5">Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="w-full h-11 bg-slate-950 border border-slate-800 rounded-lg px-3 text-[15px] text-white cursor-pointer focus:outline-none focus:border-indigo-500">
                <option value="">— Pick a client to connect accounts —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-300 block mb-1.5">Find an account</label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Account or client name"
                  className="w-full h-11 bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {["all", ...platformChips].map((p) => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`h-9 px-3.5 flex items-center gap-2 rounded-full border text-sm font-semibold cursor-pointer transition-colors ${
                  platform === p ? "bg-indigo-500 border-indigo-500 text-black" : "bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
                }`}>
                {p !== "all" && <PlatformIcon platform={p} size={15} />}
                <span>{p === "all" ? "All" : label(p)}</span>
                {p !== "all" && selected && (mineByPlatform[p] || 0) > 0 && (
                  <span className={`text-xs font-bold rounded-full px-1.5 ${platform === p ? "bg-black/20" : "bg-emerald-500/15 text-emerald-500"}`}>{mineByPlatform[p]}</span>
                )}
              </button>
            ))}
          </div>

          <p className="text-sm text-slate-400">
            {selected
              ? <><b className="text-white">{selected.name}</b> has {Object.values(mineByPlatform).reduce((n, c) => n + c, 0)} account(s) connected. Click <b className="text-slate-200">Connect</b> on any account below to add another.</>
              : <>Showing all {accounts.length} account(s) in RecurPost — {unconnected} not connected to any client. Pick a client to connect accounts.</>}
            {refreshedAt && <span className="text-slate-500"> · Updated {refreshedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>

          {error && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-2">
          {loading && accounts.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Asking RecurPost for its accounts…</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">
              {accounts.length === 0 ? "RecurPost returned no accounts. Add them in RecurPost, then press Refresh." : "No account matches. Clear the search, or add it in RecurPost and press Refresh."}
            </p>
          ) : rows.map(({ a, owner, mine, looksLikeIt }) => (
            <div key={a.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${mine ? "border-emerald-600/50 bg-emerald-500/10" : "border-slate-900 bg-slate-950/60"}`}>
              <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                <PlatformIcon platform={platformOf(a)} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-white truncate">{a.name}</p>
                <p className="text-[13px] text-slate-400 truncate">
                  {a.typeLabel || label(platformOf(a))}
                  {mine ? <span className="text-emerald-500 font-semibold"> · Connected to {selected?.name}</span>
                    : owner ? <span> · Used by <b className="text-slate-200">{clientName(owner)}</b></span>
                    : <span className="text-slate-500"> · Not connected{looksLikeIt ? " — looks like this client's" : ""}</span>}
                  {a.connected === false && <span className="text-amber-400 font-semibold"> · Needs reconnecting in RecurPost</span>}
                </p>
              </div>
              <div className="shrink-0">
                {busyId === a.id ? (
                  <span className="h-10 px-4 flex items-center"><Loader2 className="w-4 h-4 animate-spin text-indigo-400" /></span>
                ) : mine ? (
                  <button onClick={() => { if (confirm(`Disconnect "${a.name}" from ${selected?.name}? Posts for this client will stop going to it.`)) void change(a, "disconnect"); }}
                    className="h-10 px-4 rounded-lg border border-slate-800 bg-slate-950 text-sm font-semibold text-slate-300 hover:text-rose-300 hover:border-rose-800 cursor-pointer">
                    Disconnect
                  </button>
                ) : !clientId ? (
                  owner ? null : <span className="text-[13px] text-slate-500">Pick a client</span>
                ) : owner ? (
                  <button onClick={() => { if (confirm(`"${a.name}" is connected to ${clientName(owner)}.\n\nMove it to ${selected?.name}? ${clientName(owner)}'s posts will stop going to it.`)) void change(a, "connect", true); }}
                    className="h-10 px-4 rounded-lg border border-slate-800 bg-slate-950 text-sm font-semibold text-slate-400 hover:text-white hover:border-amber-700 cursor-pointer">
                    Move here
                  </button>
                ) : (
                  <button onClick={() => void change(a, "connect")}
                    className="h-10 px-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white cursor-pointer">
                    <Check className="w-4 h-4" /><span>Connect</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3.5 border-t border-slate-900 flex items-center justify-between gap-3">
          <p className="text-[13px] text-slate-500">Changes save as you click. New account in RecurPost? Press Refresh.</p>
          <button onClick={onClose} className="h-10 px-5 rounded-lg bg-slate-900 border border-slate-800 text-sm font-semibold text-white hover:border-slate-700 cursor-pointer">Done</button>
        </div>
      </div>
    </div>
  );
}
