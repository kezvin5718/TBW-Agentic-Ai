"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Table2 } from "lucide-react";
import { fmtIST } from "@/lib/time";
import Avatar from "../Avatar";
import PlatformIcon from "./PlatformIcon";

/**
 * Grids & Ads — the founder's Google-Sheet tracker, inside Social Publisher.
 *
 * The sheet's END DATE column was typed by hand and was wrong the day after
 * anyone scheduled. Here those dates come off the posting calendar on every
 * load, so they move on their own. Only the ownership and money columns are
 * typed — by the founder and the people he has named; everyone else reads.
 */

type MemberField = "scheduling_member_id" | "ads_member_id" | "content_member_id";
type TextField = "funds" | "google_funds" | "ad_budget_monthly";
type Field = MemberField | TextField | "monthly_report";

interface Tracker {
  scheduling_member_id: string | null;
  ads_member_id: string | null;
  content_member_id: string | null;
  funds: string | null;
  google_funds: string | null;
  ad_budget_monthly: string | null;
  monthly_report: "done" | "pending" | null;
  updated_at: string | null;
  updated_by: string | null;
}
interface Row {
  clientId: string;
  clientName: string;
  endDate: string | null;
  pinterestUntil: string | null;
  youtubeUntil: string | null;
  tracker: Tracker;
}
interface Member { id: string; name: string; active: boolean; avatar_url: string | null; role_title: string | null }
interface Board { today: string; canEdit: boolean; team: Member[]; rows: Row[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days from one "YYYY-MM-DD" to another — calendar dates, no zone involved. */
function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** "2026-09-30" → "30 Sep"; the year only when it isn't this one. */
function dayLabel(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ""}`;
}

type Tone = "rose" | "amber" | "emerald" | "none";
/** The sheet's colours: run out (today or past) red, within 5 days amber, beyond green. */
function toneOf(day: string | null, today: string): Tone {
  if (!day) return "none";
  const left = daysBetween(today, day);
  return left <= 0 ? "rose" : left <= 5 ? "amber" : "emerald";
}

const STRONG: Record<Tone, string> = {
  rose: "bg-rose-950/40 border-rose-900/60 text-rose-300",
  amber: "bg-amber-950/40 border-amber-900/60 text-amber-300",
  emerald: "bg-emerald-950/40 border-emerald-900/60 text-emerald-300",
  none: "border-transparent text-slate-600",
};
const LIGHT: Record<Tone, string> = { rose: "text-rose-400", amber: "text-amber-400", emerald: "text-emerald-400", none: "text-slate-600" };

function relative(day: string, today: string): string {
  const left = daysBetween(today, day);
  if (left === 0) return "runs out today";
  if (left < 0) return `ran out ${-left}d ago`;
  return `${left}d left`;
}

const OWNER_COLUMNS: { field: MemberField; label: string }[] = [
  { field: "scheduling_member_id", label: "Scheduling" },
  { field: "ads_member_id", label: "Ads/Boosting" },
  { field: "content_member_id", label: "Content" },
];
const MONEY_COLUMNS: { field: TextField; label: string; width: string }[] = [
  { field: "funds", label: "Funds", width: "min-w-[130px]" },
  { field: "google_funds", label: "Google Funds", width: "min-w-[130px]" },
  { field: "ad_budget_monthly", label: "Ad Budget monthly", width: "min-w-[140px]" },
];

const cellKey = (clientId: string, field: Field) => `${clientId}:${field}`;

export default function GridAds() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  // Per-cell save state, keyed "clientId:field" — one spinner, one error each.
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/grid-ads", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't load the tracker (${res.status})`);
      setBoard({ today: data.today, canEdit: !!data.canEdit, team: data.team || [], rows: data.rows || [] });
      setLoadedAt(new Date().toISOString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load the tracker");
    } finally {
      setLoading(false);
    }
  }, []);

  // Loaded when the tab first opens — the tab only mounts this once chosen.
  useEffect(() => { load(); }, [load]);

  /**
   * Saves one cell. The new value shows at once; if the server says no, the
   * old one comes back and the reason sits under the cell.
   */
  const save = async (clientId: string, field: Field, value: string | null) => {
    if (!board) return;
    const row = board.rows.find((r) => r.clientId === clientId);
    if (!row) return;
    const before = row.tracker[field];
    if ((before ?? null) === (value ?? null)) return;

    const key = cellKey(clientId, field);
    const setField = (v: string | null) => setBoard((b) => b && {
      ...b,
      rows: b.rows.map((r) => (r.clientId === clientId ? { ...r, tracker: { ...r.tracker, [field]: v } } : r)),
    });

    setField(value);
    setSaving((s) => ({ ...s, [key]: true }));
    setCellErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    try {
      const res = await fetch("/api/grid-ads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, fields: { [field]: value } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      // The server's copy wins — it is what everyone else will see (trimmed, clipped).
      const saved = data.tracker as Partial<Tracker> | undefined;
      if (saved) {
        setBoard((b) => b && {
          ...b,
          rows: b.rows.map((r) => (r.clientId === clientId ? { ...r, tracker: { ...r.tracker, ...saved } as Tracker } : r)),
        });
      }
    } catch (err: unknown) {
      setField(before);
      setCellErrors((e) => ({ ...e, [key]: err instanceof Error ? err.message : "Save failed" }));
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  };

  const counts = board
    ? board.rows.reduce((acc, r) => { acc[toneOf(r.endDate, board.today)]++; return acc; }, { rose: 0, amber: 0, emerald: 0, none: 0 } as Record<Tone, number>)
    : null;

  return (
    <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Table2 className="w-4 h-4 text-[var(--yellow)]" /><span>Grids &amp; Ads</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            End dates come from the posting calendar and update themselves — only the ownership and money columns are typed here.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {loadedAt && !loading && (
            <span className="text-[10px] text-slate-600">As of {fmtIST(loadedAt, { year: undefined })} IST</span>
          )}
          <button onClick={load} disabled={loading}
            title="Re-reads the posting calendar — anything scheduled since you opened this moves its end date"
            className="px-3 py-1.5 min-h-[40px] lg:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>{loading ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {board && counts && (
        <p className="text-[10px] text-slate-500 flex items-center gap-3 flex-wrap">
          <span className="text-rose-400">{counts.rose} run out</span>
          <span className="text-amber-400">{counts.amber} within 5 days</span>
          <span className="text-emerald-400">{counts.emerald} booked ahead</span>
          <span className="text-slate-600">{counts.none} nothing scheduled</span>
          {!board.canEdit && <span className="text-slate-600">· read-only — the founder grants editing in Team &amp; Access</span>}
        </p>
      )}

      {error && <p className="text-[11px] text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</p>}
      {!board && loading && <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading the calendar…</p>}
      {board && board.rows.length === 0 && <p className="text-[11px] text-slate-600">No active clients.</p>}

      {board && board.rows.length > 0 && (
        // Eleven columns are wider than any phone — the table scrolls in here, never the page.
        <div className="overflow-x-auto border border-slate-900 rounded-xl">
          <table className="w-full min-w-[1280px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="p-2.5 min-w-[160px]">Client</th>
                <th className="p-2.5 min-w-[120px]">End Date</th>
                <th className="p-2.5 min-w-[90px]"><span className="flex items-center gap-1.5"><PlatformIcon platform="pinterest" size={11} />Pinterest</span></th>
                <th className="p-2.5 min-w-[90px]"><span className="flex items-center gap-1.5"><PlatformIcon platform="youtube" size={11} />YouTube</span></th>
                {OWNER_COLUMNS.map((c) => <th key={c.field} className="p-2.5 min-w-[150px]">{c.label}</th>)}
                {MONEY_COLUMNS.map((c) => <th key={c.field} className={`p-2.5 ${c.width}`}>{c.label}</th>)}
                <th className="p-2.5 min-w-[120px]">Monthly Report</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => {
                const tone = toneOf(r.endDate, board.today);
                return (
                  <tr key={r.clientId} className="border-t border-slate-900 align-top">
                    <td className="p-2.5 text-[11px] font-bold text-white">{r.clientName}</td>

                    <td className="p-2.5">
                      {r.endDate ? (
                        <span className={`inline-flex flex-col px-2 py-1 rounded-md border text-[11px] font-bold leading-tight ${STRONG[tone]}`}>
                          <span>{dayLabel(r.endDate, board.today)}</span>
                          <span className="text-[9px] font-normal opacity-80">{relative(r.endDate, board.today)}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-600" title="Nothing sent or scheduled for this client yet">—</span>
                      )}
                    </td>

                    {[r.pinterestUntil, r.youtubeUntil].map((d, i) => (
                      <td key={i} className={`p-2.5 text-[11px] ${d ? `font-bold ${LIGHT[toneOf(d, board.today)]}` : "text-slate-600"}`}>
                        {d ? dayLabel(d, board.today) : "—"}
                      </td>
                    ))}

                    {OWNER_COLUMNS.map((c) => (
                      <td key={c.field} className="p-2.5">
                        <OwnerCell
                          value={r.tracker[c.field]} team={board.team} canEdit={board.canEdit}
                          saving={!!saving[cellKey(r.clientId, c.field)]} error={cellErrors[cellKey(r.clientId, c.field)]}
                          label={`${c.label} for ${r.clientName}`}
                          onSave={(v) => save(r.clientId, c.field, v)}
                        />
                      </td>
                    ))}

                    {MONEY_COLUMNS.map((c) => (
                      <td key={c.field} className="p-2.5">
                        <TextCell
                          value={r.tracker[c.field]} canEdit={board.canEdit}
                          saving={!!saving[cellKey(r.clientId, c.field)]} error={cellErrors[cellKey(r.clientId, c.field)]}
                          label={`${c.label} for ${r.clientName}`}
                          onSave={(v) => save(r.clientId, c.field, v)}
                        />
                      </td>
                    ))}

                    <td className="p-2.5">
                      <ReportCell
                        value={r.tracker.monthly_report} canEdit={board.canEdit}
                        saving={!!saving[cellKey(r.clientId, "monthly_report")]} error={cellErrors[cellKey(r.clientId, "monthly_report")]}
                        label={`Monthly report for ${r.clientName}`}
                        onSave={(v) => save(r.clientId, "monthly_report", v)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {board && (
        <p className="text-[10px] text-slate-500 flex items-center gap-3 flex-wrap">
          <span><b className="text-rose-400">Red</b> — content has run out (today or past)</span>
          <span><b className="text-amber-400">Amber</b> — runs out within 5 days</span>
          <span><b className="text-emerald-400">Green</b> — booked beyond that</span>
          <span>End Date counts feed posts and reels, not Stories; Pinterest and YouTube show their own last day.</span>
        </p>
      )}
    </div>
  );
}

function CellStatus({ saving, error }: { saving: boolean; error?: string }) {
  if (saving) return <Loader2 className="w-3 h-3 animate-spin text-slate-500 shrink-0" />;
  if (error) return <span className="block text-[10px] text-rose-400 leading-snug mt-1 break-words">{error}</span>;
  return null;
}

// Shape only; colours are added separately so a tinted select never carries
// two competing backgrounds.
const INPUT_SHAPE = "w-full border rounded-lg px-2 py-1.5 min-h-[40px] lg:min-h-0 text-[11px] focus:outline-none focus:border-indigo-500 disabled:opacity-60";
const INPUT_PLAIN = "bg-slate-950 border-slate-800 text-white";
const INPUT = `${INPUT_SHAPE} ${INPUT_PLAIN}`;

function OwnerCell({ value, team, canEdit, saving, error, label, onSave }: {
  value: string | null; team: Member[]; canEdit: boolean; saving: boolean; error?: string; label: string;
  onSave: (v: string | null) => void;
}) {
  const member = value ? team.find((m) => m.id === value) : null;

  // Read-only: the name and face, as text — no dead-looking controls.
  if (!canEdit) {
    if (!member) return <span className="text-[11px] text-slate-600">—</span>;
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-slate-200">
        <Avatar name={member.name} url={member.avatar_url} size={20} rounded="rounded-md" title={member.role_title || member.name} />
        <span>{member.name}</span>
      </span>
    );
  }

  // Dropdowns offer the active team; someone switched off but still named
  // here stays visible so the row doesn't silently read "—".
  const options = team.filter((m) => m.active || m.id === value);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {member && <Avatar name={member.name} url={member.avatar_url} size={20} rounded="rounded-md" title={member.role_title || member.name} />}
        <select aria-label={label} value={value || ""} disabled={saving}
          onChange={(e) => onSave(e.target.value || null)}
          className={`${INPUT} cursor-pointer`}>
          <option value="">—</option>
          {options.map((m) => <option key={m.id} value={m.id}>{m.name}{m.active ? "" : " (inactive)"}</option>)}
        </select>
        <CellStatus saving={saving} />
      </div>
      <CellStatus saving={false} error={error} />
    </div>
  );
}

function TextCell({ value, canEdit, saving, error, label, onSave }: {
  value: string | null; canEdit: boolean; saving: boolean; error?: string; label: string;
  onSave: (v: string | null) => void;
}) {
  const [draft, setDraft] = useState(value || "");
  // A save (or a Refresh, or a failed save reverting) replaces the value under
  // the input — follow it.
  useEffect(() => { setDraft(value || ""); }, [value]);

  if (!canEdit) {
    return value
      ? <span className="text-[11px] text-slate-200 break-words">{value}</span>
      : <span className="text-[11px] text-slate-600">—</span>;
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input aria-label={label} value={draft} maxLength={120} disabled={saving} placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const next = draft.trim() || null; if (next !== (value || null)) onSave(next); else setDraft(value || ""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setDraft(value || ""); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
          }}
          className={INPUT} />
        <CellStatus saving={saving} />
      </div>
      <CellStatus saving={false} error={error} />
    </div>
  );
}

function ReportCell({ value, canEdit, saving, error, label, onSave }: {
  value: "done" | "pending" | null; canEdit: boolean; saving: boolean; error?: string; label: string;
  onSave: (v: string | null) => void;
}) {
  // The sheet's feel: Done is green, Pending a quiet grey.
  const tone = value === "done"
    ? "bg-emerald-950/40 border-emerald-900/60 text-emerald-300"
    : value === "pending" ? "bg-slate-900 border-slate-700 text-slate-300" : "";

  if (!canEdit) {
    return value
      ? <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${tone}`}>{value === "done" ? "Done" : "Pending"}</span>
      : <span className="text-[11px] text-slate-600">—</span>;
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select aria-label={label} value={value || ""} disabled={saving}
          onChange={(e) => onSave(e.target.value || null)}
          className={`${INPUT_SHAPE} cursor-pointer font-bold ${tone || INPUT_PLAIN}`}>
          <option value="">—</option>
          <option value="done">Done</option>
          <option value="pending">Pending</option>
        </select>
        <CellStatus saving={saving} />
      </div>
      <CellStatus saving={false} error={error} />
    </div>
  );
}
