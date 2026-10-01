"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtISTDate } from "@/lib/time";
import { awayLabel } from "./TaskBoard";
import Avatar from "../Avatar";
import { Loader2, Plus, Trash2, X, GripVertical, Sparkles, Users, Wand2 } from "lucide-react";

type Kind = "master" | "adaptation" | "standalone";

interface FestivalRow { id: string; name: string; scheduled_at: string }
interface Member { id: string; name: string; role_title: string | null; away_until: string | null; avatar_url: string | null }
interface ClientRow { id: string; name: string }
interface MapNode {
  id: string;
  kind: Kind;
  client_id: string;
  client_name: string;
  designer_member_id: string | null;
  designer_name: string | null;
  designer_avatar_url: string | null;
  master_client_id: string | null;
  master_client_name: string | null;
}
interface AllotResult {
  created: number;
  skipped: string[];
  perDesigner: { name: string; count: number }[];
  festival: string;
}

const KIND_LABEL: Record<Kind, string> = { master: "Master", adaptation: "Adaptation", standalone: "Standalone" };
const EMPTY_FORM = { clientId: "", kind: "master" as Kind, masterClientId: "", designerMemberId: "" };

/** Every control here is a fingertip on a phone and a pointer on a desk. */
const SELECT = "min-h-[40px] lg:min-h-0 text-[10px] font-bold bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 lg:py-1.5 text-slate-300 cursor-pointer focus:outline-none disabled:opacity-40";
const ICON_BTN = "min-h-[40px] min-w-[40px] lg:min-h-0 lg:min-w-0 lg:p-1.5 flex items-center justify-center rounded-lg text-slate-700 hover:text-rose-400 cursor-pointer disabled:opacity-40";

/**
 * Who makes what, drawn the way the founder draws it.
 *
 * Master designers carry their master clients; under each master client hang
 * the clients whose creative is adapted from it; standalone clients get a
 * fresh design each. The map is drawn once and reused — Allot turns it into
 * this festival's tasks in one go.
 *
 * Only ever rendered for the founder and people granted it: the board above
 * shows the toggle only after the API has said yes.
 */
export default function AllotmentMap({ festivals, defaultFestivalId }: { festivals: FestivalRow[]; defaultFestivalId: string }) {
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [allotFestivalId, setAllotFestivalId] = useState(defaultFestivalId);
  const [allotting, setAllotting] = useState(false);
  const [result, setResult] = useState<AllotResult | null>(null);

  // What is in the air, and which master box it is over. Both are only for
  // the picture — the drop itself reads the id off the drag.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/festival-allotment", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Couldn't load the map."); return; }
      setNodes(d.nodes || []);
      setClients(d.clients || []);
      setTeam(d.team || []);
      setCanManage(!!d.canManage);
    } catch { setError("Couldn't load the map."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The board's festival arrives after its own list does; follow it until
  // someone picks one here.
  useEffect(() => { setAllotFestivalId((cur) => cur || defaultFestivalId); }, [defaultFestivalId]);

  /** One round trip for every edit: say what went wrong in plain words, then read the map again. */
  const send = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/festival-allotment", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "That didn't save."); return false; }
      return true;
    } catch {
      setError("That didn't save.");
      return false;
    } finally {
      await load();
      setBusy(null);
    }
  };

  const setDesigner = (n: MapNode, designerMemberId: string) =>
    send("PATCH", { id: n.id, designerMemberId: designerMemberId || null }, n.id);

  /** The drag and the row's own select both arrive here — equal power, one path. */
  const moveAdaptation = async (id: string, masterClientId: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.kind !== "adaptation" || !masterClientId || n.master_client_id === masterClientId) return;
    // The row moves before the round trip; the reload that follows is the truth.
    setNodes((prev) => prev.map((x) => (x.id === id ? { ...x, master_client_id: masterClientId } : x)));
    await send("PATCH", { id, masterClientId }, id);
  };

  const remove = async (n: MapNode) => {
    if (!confirm(`Take ${n.client_name} off the allotment map? Tasks already allotted stay where they are.`)) return;
    await send("DELETE", { id: n.id }, n.id);
  };

  const addClient = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/festival-allotment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          clientId: form.clientId,
          designerMemberId: form.designerMemberId || null,
          masterClientId: form.kind === "adaptation" ? form.masterClientId || null : null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      // The API's own words, right under the form that caused them.
      if (!res.ok) { setAddError(d.error || "Couldn't add that client."); return; }
      // The kind and master are kept: adding the next adaptation under the
      // same master is the usual next move.
      setForm((f) => ({ ...f, clientId: "" }));
      await load();
    } catch {
      setAddError("Couldn't add that client.");
    } finally { setAdding(false); }
  };

  const runAllot = async () => {
    const f = festivals.find((x) => x.id === allotFestivalId);
    if (!f) return;
    if (!confirm(`This creates up to ${nodes.length} task${nodes.length === 1 ? "" : "s"} for ${f.name}. Continue?`)) return;
    setAllotting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/festival-allotment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allot: true, festivalId: f.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Allot didn't go through."); return; }
      setResult({ created: d.created || 0, skipped: d.skipped || [], perDesigner: d.perDesigner || [], festival: f.name });
    } catch {
      setError("Allot didn't go through.");
    } finally { setAllotting(false); }
  };

  // ── The map, arranged ─────────────────────────────────────────────────────
  const masters = useMemo(() => nodes.filter((n) => n.kind === "master"), [nodes]);
  const standalones = useMemo(() => nodes.filter((n) => n.kind === "standalone"), [nodes]);
  const adaptationsOf = useMemo(() => {
    const m = new Map<string, MapNode[]>();
    for (const n of nodes) {
      if (n.kind !== "adaptation" || !n.master_client_id) continue;
      m.set(n.master_client_id, [...(m.get(n.master_client_id) || []), n]);
    }
    return m;
  }, [nodes]);
  const memberById = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const masterIds = useMemo(() => new Set(masters.map((m) => m.client_id)), [masters]);
  // The API never lets an adaptation lose its master, but a row edited in the
  // database by hand could — it shows up here to be re-pointed, not vanish.
  const strays = useMemo(
    () => nodes.filter((n) => n.kind === "adaptation" && !masterIds.has(n.master_client_id || "")),
    [nodes, masterIds]
  );

  /** One card per master designer, A to Z; masters nobody makes yet come last. */
  const designerGroups = useMemo(() => {
    const groups = new Map<string, MapNode[]>();
    for (const n of masters) {
      const key = n.designer_member_id || "";
      groups.set(key, [...(groups.get(key) || []), n]);
    }
    return [...groups.entries()]
      .map(([key, list]) => ({ key, name: list[0].designer_name, avatar: list[0].designer_avatar_url, masters: list }))
      .sort((a, b) => (!a.key ? 1 : !b.key ? -1 : (a.name || "").localeCompare(b.name || "")));
  }, [masters]);

  const onMap = useMemo(() => new Set(nodes.map((n) => n.client_id)), [nodes]);
  const freeClients = clients.filter((c) => !onMap.has(c.id));

  /** A designer select; a designer who has since left still reads by name. */
  const designerSelect = (n: MapNode, label: string) => (
    <select value={n.designer_member_id || ""} disabled={busy === n.id} title={label}
      onChange={(e) => setDesigner(n, e.target.value)} className={SELECT}>
      <option value="">No designer yet</option>
      {n.designer_member_id && !memberById.has(n.designer_member_id) && (
        <option value={n.designer_member_id}>{n.designer_name || "Former member"} (inactive)</option>
      )}
      {team.map((m) => <option key={m.id} value={m.id}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
    </select>
  );

  const deleteButton = (n: MapNode) => (
    <button onClick={() => remove(n)} disabled={busy === n.id} title={`Take ${n.client_name} off the map`} className={ICON_BTN}>
      {busy === n.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : <Trash2 className="w-3.5 h-3.5" />}
    </button>
  );

  const adaptationRow = (n: MapNode) => (
    <div key={n.id}
      draggable={canManage}
      // setData must happen inside the event, but the state write is DEFERRED:
      // re-rendering the dragged node while dragstart is still settling makes
      // Chrome cancel the whole drag on the spot.
      onDragStart={canManage ? (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", n.id);
        window.setTimeout(() => setDragId(n.id), 0);
      } : undefined}
      onDragEnd={canManage ? () => { setDragId(null); setDragOver(null); } : undefined}
      title={canManage ? "Drag onto another master to adapt from it instead" : undefined}
      className={`flex flex-wrap items-center gap-2 pl-1 pr-1 py-1 rounded-lg border border-slate-900/70 bg-slate-950/70 ${canManage ? "lg:cursor-grab lg:active:cursor-grabbing" : ""} ${dragId === n.id ? "opacity-40" : ""}`}>
      {/* The handle is a desk thing — phones move rows with the select instead. */}
      <GripVertical className="hidden lg:block w-3.5 h-3.5 text-slate-700 shrink-0" />
      <span className="text-[11px] font-semibold text-slate-200 min-w-[90px] flex-1 truncate">{n.client_name}</span>
      {designerSelect(n, "Who adapts it")}
      {/* The equal-power fallback to dragging, and the only way on a phone. */}
      <select value={masterIds.has(n.master_client_id || "") ? n.master_client_id || "" : ""} disabled={busy === n.id} title="Adapted from"
        onChange={(e) => moveAdaptation(n.id, e.target.value)} className={SELECT}>
        {!masterIds.has(n.master_client_id || "") && <option value="">Pick a master…</option>}
        {masters.map((m) => <option key={m.client_id} value={m.client_id}>from {m.client_name}</option>)}
      </select>
      {deleteButton(n)}
    </div>
  );

  const masterBox = (n: MapNode) => {
    const kids = adaptationsOf.get(n.client_id) || [];
    const hovered = dragOver === n.client_id && dragId !== null;
    return (
      <div key={n.id}
        // preventDefault on dragover is what PERMITS a drop at all, so it
        // cannot wait on dragId state — gate on the grant alone.
        onDragOver={canManage ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(n.client_id); } : undefined}
        onDragLeave={canManage ? () => setDragOver((c) => (c === n.client_id ? null : c)) : undefined}
        onDrop={canManage ? (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain") || dragId;
          setDragId(null);
          setDragOver(null);
          if (id) moveAdaptation(id, n.client_id);
        } : undefined}
        className={`rounded-xl border bg-slate-950/60 p-2.5 space-y-2 transition-shadow ${hovered ? "border-2 border-dashed border-indigo-500" : "border-slate-900"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[var(--yellow)] shrink-0" />
          <span className="text-xs font-bold text-white flex-1 min-w-[90px] truncate">{n.client_name}</span>
          {designerSelect(n, "Master designer")}
          {deleteButton(n)}
        </div>
        {kids.length === 0 ? (
          <p className="text-[10px] text-slate-600 pl-1">No adaptations — drop one here, or add a client as an adaptation of {n.client_name}.</p>
        ) : (
          <div className="space-y-1 pl-2 border-l border-slate-800">{kids.map(adaptationRow)}</div>
        )}
      </div>
    );
  };

  const allotFestival = festivals.find((f) => f.id === allotFestivalId);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Allot bar: the map, turned into this festival's tasks. */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <select value={allotFestivalId} onChange={(e) => { setAllotFestivalId(e.target.value); setResult(null); }}
          className="min-h-[40px] lg:min-h-0 text-[11px] font-bold bg-slate-950 border border-slate-900 rounded-xl px-3 py-2 text-slate-200 cursor-pointer focus:outline-none">
          {festivals.length === 0 && <option value="">No festivals yet</option>}
          {festivals.map((f) => <option key={f.id} value={f.id}>{f.name} · {fmtISTDate(f.scheduled_at)}</option>)}
        </select>
        <button onClick={runAllot} disabled={allotting || !allotFestival || nodes.length === 0}
          className="flex items-center justify-center gap-1.5 min-h-[40px] lg:min-h-0 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40">
          {allotting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          <span>{allotFestival ? `Allot ${allotFestival.name} — creates the tasks` : "Allot — creates the tasks"}</span>
        </button>
        <span className="text-[10px] text-slate-600 font-mono sm:ml-auto">
          {masters.length} master · {nodes.length - masters.length - standalones.length} adaptation · {standalones.length} standalone
        </span>
      </div>

      {result && (
        <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-xl px-3 py-2 text-[11px] text-slate-300 flex items-start gap-2">
          <p className="flex-1">
            <span className="font-bold text-emerald-400">{result.created} task{result.created === 1 ? "" : "s"} created</span> for {result.festival}
            {result.perDesigner.length > 0 && <> — {result.perDesigner.map((p) => `${p.name} ${p.count}`).join(", ")}</>}
            {result.skipped.length > 0 && (
              <>; <span className="text-amber-400 font-bold">{result.skipped.length} already allotted</span>: {result.skipped.join(", ")}</>
            )}
            .
          </p>
          <button onClick={() => setResult(null)} className={ICON_BTN} title="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {error && (
        <div className="bg-rose-950/20 border border-rose-900/60 rounded-xl px-3 py-2 text-[11px] text-rose-300 flex items-start gap-2">
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className={ICON_BTN} title="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Add: any client not yet on the map, as any kind. */}
      <div className="space-y-2">
        <button onClick={() => { setShowAdd((v) => !v); setAddError(null); }}
          className="flex items-center gap-1.5 min-h-[40px] lg:min-h-0 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-700 text-slate-200 text-[11px] font-bold cursor-pointer">
          <Plus className="w-3.5 h-3.5" /><span>Add client</span>
        </button>
        {showAdd && (
          <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
              <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} className={SELECT}>
                <option value="">{freeClients.length ? "Client…" : "Every client is on the map"}</option>
                {freeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Kind }))} className={SELECT}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              {form.kind === "adaptation" && (
                <select value={form.masterClientId} onChange={(e) => setForm((f) => ({ ...f, masterClientId: e.target.value }))} className={SELECT}>
                  <option value="">{masters.length ? "Adapted from…" : "Add a master first"}</option>
                  {masters.map((m) => <option key={m.client_id} value={m.client_id}>{m.client_name}</option>)}
                </select>
              )}
              <select value={form.designerMemberId} onChange={(e) => setForm((f) => ({ ...f, designerMemberId: e.target.value }))} className={SELECT}>
                <option value="">{form.kind === "adaptation" ? "Adapted by…" : "Designed by…"}</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}{awayLabel(m.away_until) ? ` — ${awayLabel(m.away_until)}` : ""}</option>)}
              </select>
              <button onClick={addClient} disabled={adding || !form.clientId}
                className="flex items-center justify-center gap-1.5 min-h-[40px] lg:min-h-0 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40">
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}<span>Add</span>
              </button>
              <button onClick={() => { setShowAdd(false); setAddError(null); }} className={ICON_BTN} title="Close"><X className="w-3.5 h-3.5" /></button>
            </div>
            {addError && <p className="text-[11px] text-rose-400">{addError}</p>}
          </div>
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="text-xs text-slate-600 py-12 text-center">
          The map is empty. Use <span className="text-slate-300 font-semibold">Add client</span> to put the first master on it.
        </p>
      ) : (
        <>
          {/* One card per master designer — stacked on a phone, side by side
              on a desk, the founder's columns without forcing them. */}
          {designerGroups.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
              {designerGroups.map((g) => {
                const live = g.key ? memberById.get(g.key) : null;
                return (
                  <div key={g.key || "nobody"} className="border border-slate-900 rounded-2xl bg-slate-950/40 p-3 space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      {g.key ? (
                        <Avatar name={g.name} url={live?.avatar_url || g.avatar} size={28} rounded="rounded-full" />
                      ) : (
                        <Users className="w-4 h-4 text-indigo-400" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{g.key ? g.name || "Former member" : "No master designer yet"}</p>
                        <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                          Master designer · {g.masters.length} client{g.masters.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">{g.masters.map(masterBox)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {strays.length > 0 && (
            <div className="border border-amber-900/60 rounded-2xl bg-amber-950/10 p-3 space-y-2">
              <h3 className="text-xs font-bold text-amber-400">Adaptations with no master — pick one for each</h3>
              <div className="space-y-1">{strays.map(adaptationRow)}</div>
            </div>
          )}

          {/* Fresh designs — nobody adapts these, and nobody adapts from them. */}
          <div className="border border-slate-900 rounded-2xl bg-slate-950/40 p-3 space-y-2">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Standalone new designs</span>
              <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-900 rounded-full px-1.5 py-0.5">{standalones.length}</span>
            </h3>
            {standalones.length === 0 ? (
              <p className="text-[10px] text-slate-600">None yet — add a client as Standalone for a fresh design every festival.</p>
            ) : (
              <div className="space-y-1">
                {standalones.map((n) => (
                  <div key={n.id} className="flex flex-wrap items-center gap-2 px-1 py-1 rounded-lg border border-slate-900/70 bg-slate-950/70">
                    <span className="text-[11px] font-semibold text-slate-200 min-w-[90px] flex-1 truncate pl-1">{n.client_name}</span>
                    {designerSelect(n, "Designer")}
                    {deleteButton(n)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
