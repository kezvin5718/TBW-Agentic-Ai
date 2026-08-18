"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtIST } from "@/lib/time";
import { Loader2, Send, UserPlus, CheckCircle2, AlertTriangle, MessageSquare } from "lucide-react";

interface Contact {
  number: string; push_name: string | null; label: string | null;
  client_id: string | null; status: string; first_seen: string;
  clients?: { name: string } | null;
}
interface OutboxRow {
  id: string; to_label: string | null; body: string | null; media_kind: string | null;
  status: string; error: string | null; created_at: string; sent_at: string | null;
  clients?: { name: string } | null; profiles?: { name: string } | null;
}
interface ClientRow { id: string; name: string }

/**
 * The two-way half of the bridge: naming the people who DM the bot number, and
 * the send queue. Sending is deliberately a queue with a person behind every
 * row — the reader paces them out one at a time, and nothing in the system can
 * message a client without a row created here or by a signed-in staff member.
 */
export default function WaBridgePanels() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { label: string; clientId: string }>>({});

  // Send panel
  const [sendClient, setSendClient] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cRes, oRes] = await Promise.all([fetch("/api/wa/contacts"), fetch("/api/wa/outbox")]);
      if (cRes.ok) setContacts((await cRes.json()).contacts || []);
      if (oRes.ok) setOutbox((await oRes.json()).outbox || []);
    } catch { /* panels just stay as they were */ }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("clients").select("id, name").is("archived_at", null).order("name");
      setClients((data || []) as ClientRow[]);
    })();
    load();
    const t = setInterval(load, 20000); // outbox statuses move as the reader sends
    return () => clearInterval(t);
  }, [load]);

  const assign = async (number: string) => {
    const d = drafts[number] || { label: "", clientId: "" };
    if (!d.label.trim() && !d.clientId) {
      setNotice({ ok: false, text: "Give the number a name, a client, or both." });
      return;
    }
    setBusy(number);
    try {
      const res = await fetch("/api/wa/contacts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, label: d.label, clientId: d.clientId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not save");
      setNotice({ ok: true, text: "Saved — their past and future messages now carry this name." });
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally { setBusy(null); }
  };

  const ignore = async (number: string) => {
    setBusy(number);
    try {
      await fetch("/api/wa/contacts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, status: "ignored" }),
      });
      await load();
    } finally { setBusy(null); }
  };

  const queueSend = async () => {
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/wa/outbox", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: sendClient, body: sendBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not queue it");
      setNotice({ ok: true, text: data.message });
      setSendBody("");
      await load();
    } catch (err: unknown) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not queue it" });
    } finally { setSending(false); }
  };

  const tray = contacts.filter((c) => c.status === "new");
  const named = contacts.filter((c) => c.status === "assigned");

  return (
    <div className="space-y-5 mt-6">
      {notice && (
        <div className={`rounded-xl p-3 text-sm flex items-start space-x-2 border ${notice.ok ? "bg-emerald-950/30 border-emerald-900/60 text-emerald-300" : "bg-rose-950/30 border-rose-900/60 text-rose-300"}`}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* New senders — the DM rename tray */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[var(--yellow)]" />
          <span>New senders</span>
          {tray.length > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-900 text-amber-400">{tray.length} waiting</span>}
        </h3>
        <p className="text-[11px] text-slate-500">
          People who messaged the bot number directly. Name them once — unknown numbers never become tasks, they wait here.
        </p>
        {tray.length === 0 ? (
          <p className="text-xs text-slate-600 py-2">Nobody new.</p>
        ) : tray.map((c) => {
          const d = drafts[c.number] || { label: "", clientId: "" };
          return (
            <div key={c.number} className="flex items-center gap-2 flex-wrap border border-slate-900 rounded-xl p-3 bg-slate-950/60">
              <div className="min-w-[170px]">
                <p className="text-xs font-bold text-white">+{c.number}</p>
                <p className="text-[10px] text-slate-500">calls themselves &quot;{c.push_name || "?"}&quot; · first seen {fmtIST(c.first_seen)}</p>
              </div>
              <input value={d.label} onChange={(e) => setDrafts((p) => ({ ...p, [c.number]: { ...d, label: e.target.value } }))}
                placeholder="Who is this? e.g. Ramesh — owner"
                className="flex-1 min-w-[180px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              <select value={d.clientId} onChange={(e) => setDrafts((p) => ({ ...p, [c.number]: { ...d, clientId: e.target.value } }))}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white cursor-pointer focus:outline-none">
                <option value="">— client —</option>
                {clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
              <button onClick={() => assign(c.number)} disabled={busy === c.number}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50">
                {busy === c.number ? "…" : "Save"}
              </button>
              <button onClick={() => ignore(c.number)} disabled={busy === c.number}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-slate-400 hover:text-white cursor-pointer disabled:opacity-50">
                Ignore
              </button>
            </div>
          );
        })}
        {named.length > 0 && (
          <p className="text-[10px] text-slate-600">
            Named: {named.slice(0, 8).map((c) => `${c.label || c.number}${c.clients?.name ? ` (${c.clients.name})` : ""}`).join(" · ")}{named.length > 8 ? ` · +${named.length - 8} more` : ""}
          </p>
        )}
      </div>

      {/* Send an update — the human gate on outbound */}
      <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Send className="w-4 h-4 text-[var(--yellow)]" /><span>Send an update to a client group</span>
        </h3>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="min-w-[200px]">
            <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Client (their mapped group)</span>
            <select value={sendClient} onChange={(e) => setSendClient(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer focus:outline-none focus:border-indigo-500">
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <span className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Message</span>
            <textarea value={sendBody} onChange={(e) => setSendBody(e.target.value)} rows={2}
              placeholder="e.g. Your Raksha Bandhan story is scheduled for the 28th at 9 AM — going out on Instagram and Facebook."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
          </div>
          <button onClick={queueSend} disabled={sending || !sendClient || !sendBody.trim()}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold ${!sending && sendClient && sendBody.trim() ? "bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer" : "bg-slate-950 border border-slate-900 text-slate-600 cursor-not-allowed"}`}>
            {sending ? "Queuing…" : "Queue send"}
          </button>
        </div>
        <p className="text-[10px] text-slate-600">
          Sends go out one at a time with a human pace — never a blast. Reports and creatives can also be queued from here later; text first.
        </p>
      </div>

      {/* Outbox — what went, what failed */}
      {outbox.length > 0 && (
        <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-5 space-y-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[var(--yellow)]" /><span>Outbox</span>
          </h3>
          {outbox.slice(0, 12).map((o) => (
            <div key={o.id} className="flex items-center gap-2 flex-wrap text-[11px] border-b border-slate-900/60 py-1.5">
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                o.status === "sent" ? "bg-emerald-950/40 border-emerald-900 text-emerald-400"
                : o.status === "failed" ? "bg-rose-950/40 border-rose-900 text-rose-400"
                : "bg-amber-950/40 border-amber-900 text-amber-400"}`}>
                {o.status === "queued" ? <Loader2 className="w-3 h-3 animate-spin inline" /> : o.status}
              </span>
              <span className="font-bold text-white">{o.to_label || "?"}</span>
              <span className="text-slate-400 truncate flex-1">{(o.body || `[${o.media_kind}]`).slice(0, 80)}</span>
              <span className="text-slate-600">{fmtIST(o.sent_at || o.created_at)}</span>
              {o.error && <span className="text-rose-400 w-full">↳ {o.error.slice(0, 120)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
