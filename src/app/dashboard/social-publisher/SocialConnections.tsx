"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Ghost, Loader2, Minus, Plug, RefreshCw, Trash2 } from "lucide-react";
import { fmtIST, fmtISTDate } from "@/lib/time";
import PlatformIcon, { PLATFORM_LABEL } from "./PlatformIcon";

/**
 * Social Connections — the health board for every client × platform mapping.
 *
 * RecurPost's own green badge said Swarna Kanchi's YouTube was connected while
 * every send to it came back 401. This board shows what is actually true:
 * whether the mapped account still exists, what our sends to it have been
 * answering, and — on Refresh — what the account says when asked directly.
 */

const PLATFORMS = ["instagram", "facebook", "pinterest", "youtube"] as const;
const OPEN_KEY = "tbw.socialpublisher.connectionsOpen";

type CellState = "connected" | "failing" | "dead" | "unmapped";
interface Cell {
  clientId: string;
  clientName: string;
  platform: string;
  state: CellState;
  accountId: string | null;
  deadAccountIds: string[];
  mappedCount: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  failureSince: string | null;
  reason: string | null;
  reasonFull: string | null;
  probe: "ok" | "failing" | "unknown" | null;
  probeNote: string | null;
}
interface Board {
  cells: Cell[];
  refreshedAt: string;
  probed: boolean;
  canRemove: boolean;
  liveListOk: boolean;
  warning: string | null;
}

const shortDate = (d: string | null) => (d ? fmtISTDate(d).replace(/ \d{4}$/, "") : "—");

export default function SocialConnections({ standalone = false }: { standalone?: boolean }) {
  // Collapsed until someone opens it; remembered after that, like the task
  // board's Completed strip — whoever checks this daily shouldn't re-open it
  // daily. As its own page (standalone) it is simply always open.
  const [open, setOpen] = useState(standalone);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState<"plain" | "probe" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (standalone) return;
    try { if (localStorage.getItem(OPEN_KEY) === "1") setOpen(true); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try { localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  };

  const load = useCallback(async (probe: boolean) => {
    setLoading(probe ? "probe" : "plain");
    setError(null);
    try {
      const res = await fetch(`/api/social-connections${probe ? "?probe=1" : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't load the board (${res.status})`);
      setBoard(data as Board);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load the board");
    } finally {
      setLoading(null);
    }
  }, []);

  // The plain board on first open — instant, no RecurPost calls beyond the
  // list. Once only: a failed load waits for Refresh rather than looping.
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open && !tried) { setTried(true); load(false); }
  }, [open, tried, load]);

  const remove = async (cell: Cell, accountId: string) => {
    const label = `${cell.clientName} · ${PLATFORM_LABEL[cell.platform] || cell.platform}`;
    if (!confirm(`Remove the dead mapping for ${label}?\n\nAccount id ${accountId} is no longer in RecurPost. This only deletes the stale mapping — nothing in RecurPost changes.`)) return;
    setBusyId(accountId);
    setNotice(null);
    try {
      const res = await fetch("/api/social-connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Remove failed (${res.status})`);
      setNotice({ ok: true, text: `Removed the dead mapping for ${label}.` });
      await load(false);
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Remove failed" });
    } finally {
      setBusyId(null);
    }
  };

  // Rows with something wrong go first — that's what anyone opening this is
  // looking for — then alphabetical.
  const rows = useMemo(() => {
    if (!board) return [];
    const byClient = new Map<string, { name: string; cells: Record<string, Cell> }>();
    for (const c of board.cells) {
      const r = byClient.get(c.clientId) || { name: c.clientName, cells: {} };
      r.cells[c.platform] = c;
      byClient.set(c.clientId, r);
    }
    const trouble = (r: { cells: Record<string, Cell> }) =>
      Object.values(r.cells).some((c) => c.state === "failing" || c.state === "dead" || c.deadAccountIds.length > 0);
    return [...byClient.entries()]
      .map(([id, r]) => ({ id, ...r, trouble: trouble(r) }))
      .sort((a, b) => (a.trouble === b.trouble ? a.name.localeCompare(b.name) : a.trouble ? -1 : 1));
  }, [board]);

  const counts = useMemo(() => {
    const out = { connected: 0, failing: 0, dead: 0, unmapped: 0 };
    for (const c of board?.cells || []) out[c.state]++;
    return out;
  }, [board]);

  return (
    <div className="bg-slate-950/40 border border-slate-900 rounded-2xl">
      <button onClick={toggle}
        className="w-full p-4 min-h-[40px] lg:min-h-0 cursor-pointer text-xs font-bold text-slate-400 hover:text-white flex items-center gap-2 text-left">
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <Plug className="w-4 h-4 shrink-0" />
        <span>Social Connections — the true state of every client account</span>
        {board && (counts.failing > 0 || counts.dead > 0) && (
          <span className="ml-auto text-[10px] text-rose-400">
            {counts.failing > 0 && `${counts.failing} failing`}{counts.failing > 0 && counts.dead > 0 && " · "}{counts.dead > 0 && `${counts.dead} dead`}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => load(true)} disabled={!!loading}
              title="Asks every mapped account for its history — a dead token shows up even if nothing was sent lately"
              className="px-3 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
              {loading === "probe" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{loading === "probe" ? "Checking every account…" : "Refresh"}</span>
            </button>
            <span className="text-[10px] text-slate-500">
              {loading === "plain" ? "Loading…"
                : board ? (board.probed
                  ? `Checked live at ${fmtIST(board.refreshedAt, { year: undefined })} IST`
                  : `From mappings and send history · ${fmtIST(board.refreshedAt, { year: undefined })} IST — Refresh to check each account live`)
                : null}
            </span>
          </div>

          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          {board?.warning && (
            <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{board.warning}</p>
          )}
          {notice && <p className={`text-[11px] ${notice.ok ? "text-emerald-400" : "text-rose-400"}`}>{notice.text}</p>}

          {board && rows.length === 0 && <p className="text-[11px] text-slate-600">No mapped accounts and no sends in the last 30 days.</p>}

          {board && rows.length > 0 && (
            // The grid is wider than a phone — it scrolls in here, never the page.
            <div className="overflow-x-auto border border-slate-900 rounded-xl">
              <table className="w-full min-w-[760px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="p-2.5 w-[180px]">Client</th>
                    {PLATFORMS.map((p) => (
                      <th key={p} className="p-2.5">
                        <span className="flex items-center gap-1.5"><PlatformIcon platform={p} size={11} />{PLATFORM_LABEL[p]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-900 align-top">
                      <td className="p-2.5 text-[11px] font-bold text-white">{r.name}</td>
                      {PLATFORMS.map((p) => (
                        <td key={p} className="p-2.5">
                          {r.cells[p] && (
                            <CellView cell={r.cells[p]} canRemove={board.canRemove} busyId={busyId} onRemove={remove} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {board && (
            <>
              <p className="text-[10px] text-slate-500 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" />Connected — sends landing</span>
                <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-400" />Failing — latest send failed, or the live check found a dead token</span>
                <span className="flex items-center gap-1"><Ghost className="w-3 h-3 text-rose-400" />Dead mapping — the id is gone from RecurPost</span>
                <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-slate-600" />Not mapped</span>
              </p>
              <p className="text-[10px] text-slate-600">
                Reconnecting happens in RecurPost (Social Profiles) — after reconnecting, Refresh accounts in the mapping panel above and re-map, then Refresh here.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CellView({ cell, canRemove, busyId, onRemove }: {
  cell: Cell;
  canRemove: boolean;
  busyId: string | null;
  onRemove: (cell: Cell, accountId: string) => void;
}) {
  const tip = [cell.reasonFull, cell.probeNote && cell.probeNote !== cell.reasonFull ? cell.probeNote : null, cell.accountId ? `Account id: ${cell.accountId}` : null]
    .filter(Boolean).join("\n");

  // Stale ids sitting beside the one in use — harmless today, but they're the
  // shadowing trap waiting to happen, so the founder can clear them here too.
  const extraDead = cell.deadAccountIds.filter((id) => id !== cell.accountId);
  const removeBtn = (id: string, label: string) => (
    <button key={id} onClick={() => onRemove(cell, id)} disabled={busyId === id}
      title={`Remove mapping ${id}`}
      className="mt-1 px-2 py-1 min-h-[40px] lg:min-h-0 rounded-md bg-rose-950/40 border border-rose-900/60 hover:border-rose-600 text-[10px] font-bold text-rose-300 cursor-pointer disabled:opacity-50 flex items-center gap-1">
      {busyId === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      <span>{label}</span>
    </button>
  );

  return (
    <div title={tip || undefined} className="text-[11px] leading-snug space-y-0.5">
      {cell.state === "connected" && (
        <>
          <span className="flex items-center gap-1 font-bold text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" />Connected</span>
          <span className="block text-[10px] text-slate-500">{cell.lastSuccess ? `last sent ${shortDate(cell.lastSuccess)}` : "no sends in 30 days"}</span>
          {cell.probe === "unknown" && <span className="block text-[10px] text-slate-600">live check inconclusive</span>}
        </>
      )}

      {cell.state === "failing" && (() => {
        // A dead token (401 / the live check) is red; any other failed send amber.
        const hard = cell.probe === "failing" || /^401\b/.test(cell.reasonFull || "");
        return (
          <>
            <span className={`flex items-center gap-1 font-bold ${hard ? "text-rose-400" : "text-amber-400"}`}><AlertTriangle className="w-3.5 h-3.5" />Failing</span>
            {cell.reason && <span className="block text-[10px] text-slate-300 break-words">{cell.reason}</span>}
            <span className="block text-[10px] text-slate-500">
              {cell.failureSince ? `since ${shortDate(cell.failureSince)}` : "found on live check"}
              {cell.lastSuccess ? ` · last ok ${shortDate(cell.lastSuccess)}` : ""}
            </span>
          </>
        );
      })()}

      {cell.state === "dead" && (
        <>
          <span className="flex items-center gap-1 font-bold text-rose-400"><Ghost className="w-3.5 h-3.5" />Dead mapping</span>
          <span className="block text-[10px] text-slate-500">{cell.reason}</span>
          {canRemove && cell.accountId && removeBtn(cell.accountId, "Remove")}
        </>
      )}

      {cell.state === "unmapped" && (
        <span className="flex items-center gap-1 text-slate-600"><Minus className="w-3.5 h-3.5" />Not mapped</span>
      )}

      {extraDead.length > 0 && (
        <>
          <span className="block text-[10px] text-rose-400/80">+{extraDead.length} stale id{extraDead.length > 1 ? "s" : ""} also mapped here</span>
          {canRemove && extraDead.map((id) => removeBtn(id, `Remove …${id.slice(-6)}`))}
        </>
      )}
    </div>
  );
}
