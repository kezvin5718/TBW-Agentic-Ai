"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtIST } from "@/lib/time";
import { createClient } from "@/lib/supabase/client";
import { MessageSquare, RefreshCw, Loader2, UserPlus, Check, X, AlertTriangle, ListTodo } from "lucide-react";

interface Item {
  id: string;
  group_name: string | null;
  sender_name: string | null;
  message_text: string | null;
  received_at: string;
  ai_summary: string | null;
  is_task: boolean | null;
  urgency: "low" | "medium" | "high" | null;
  status: string;
  extracted: boolean;
  task_id: string | null;
  clients?: { name: string } | null;
  profiles?: { name: string } | null;
}
interface Staff { id: string; name: string | null }

const URG: Record<string, string> = {
  high: "bg-rose-950/40 border-rose-900 text-rose-400",
  medium: "bg-amber-950/40 border-amber-900 text-amber-400",
  low: "bg-slate-900 border-slate-800 text-slate-500",
};

export default function WhatsAppInboxPage() {
  const [tab, setTab] = useState<"new" | "assigned" | "done">("new");
  const [items, setItems] = useState<Item[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const fetchItems = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp-inbox?status=${status}`);
      if (res.ok) setItems((await res.json()).items || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user?.id || null);
      const { data } = await supabase.from("profiles").select("id, name").in("role", ["founder", "employee"]);
      setStaff(data || []);
    })();
  }, []);
  useEffect(() => { fetchItems(tab); }, [tab, fetchItems]);

  const runExtract = async () => {
    setExtracting(true);
    try { await fetch("/api/whatsapp-inbox/extract", { method: "POST" }); await fetchItems(tab); }
    finally { setExtracting(false); }
  };

  const act = async (id: string, action: string, assignedTo?: string) => {
    setBusy(id);
    try {
      await fetch("/api/whatsapp-inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, assignedTo }) });
      await fetchItems(tab);
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <MessageSquare className="w-6 h-6 text-emerald-400" /><span>WhatsApp Task Bar</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Client group messages, read-only. AI flags the tasks; you assign &amp; act. The system never replies on WhatsApp.</p>
        </div>
        <button onClick={runExtract} disabled={extracting} className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-indigo-600 text-white flex items-center space-x-2 cursor-pointer disabled:opacity-60">
          {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}<span>Scan new</span>
        </button>
      </div>

      <div className="flex bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider w-fit">
        {(["new", "assigned", "done"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${tab === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
            {t === "new" ? "New" : t === "assigned" ? "Assigned" : "Done"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-600 py-16 text-center">Nothing here. New client group messages will appear once the WhatsApp reader is running and you click <span className="text-slate-300 font-semibold">Scan new</span>.</p>
      ) : (
        <div className="space-y-3">
          {items.map((i) => (
            <div key={i.id} className="bg-slate-950/60 border border-slate-900 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-bold text-slate-300">{i.clients?.name || i.group_name || "Unknown group"}</span>
                  <span>· {i.sender_name || "—"}</span>
                  <span>· {fmtIST(i.received_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {i.is_task && <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-400">TASK</span>}
                  {i.urgency && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${URG[i.urgency]}`}>{i.urgency.toUpperCase()}</span>}
                  {!i.extracted && <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-500 flex items-center space-x-1"><AlertTriangle className="w-2.5 h-2.5" /><span>UNSCANNED</span></span>}
                </div>
              </div>

              {i.ai_summary && <p className="text-xs text-white font-semibold">{i.ai_summary}</p>}
              <p className="text-[11px] text-slate-500 whitespace-pre-wrap break-words">{i.message_text}</p>

              {i.profiles?.name && <p className="text-[10px] text-emerald-400">Assigned to {i.profiles.name}</p>}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                {i.task_id && <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-900 text-indigo-300 flex items-center space-x-1"><ListTodo className="w-2.5 h-2.5" /><span>ON TASK BOARD</span></span>}
                {tab !== "done" && (
                  <>
                    {!i.task_id && (
                      <button disabled={!!busy} onClick={() => act(i.id, "create_task")} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer flex items-center space-x-1"><ListTodo className="w-3 h-3" /><span>Make Task</span></button>
                    )}
                    <button disabled={!!busy} onClick={() => act(i.id, "assign", me || undefined)} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-900 text-indigo-300 hover:bg-indigo-900/40 cursor-pointer flex items-center space-x-1"><UserPlus className="w-3 h-3" /><span>Assign to me</span></button>
                    <select disabled={!!busy} onChange={(e) => e.target.value && act(i.id, "assign", e.target.value)} defaultValue="" className="text-[10px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 cursor-pointer focus:outline-none">
                      <option value="">Assign to…</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name || "Staff"}</option>)}
                    </select>
                    <button disabled={!!busy} onClick={() => act(i.id, "done")} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-900 text-emerald-300 hover:bg-emerald-900/40 cursor-pointer flex items-center space-x-1"><Check className="w-3 h-3" /><span>Done</span></button>
                    <button disabled={!!busy} onClick={() => act(i.id, "dismiss")} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer flex items-center space-x-1"><X className="w-3 h-3" /><span>Dismiss</span></button>
                  </>
                )}
                {busy === i.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
