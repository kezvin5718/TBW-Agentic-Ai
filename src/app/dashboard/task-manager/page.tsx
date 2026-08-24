"use client";

import { useState, useEffect } from "react";
import { ListTodo, Users, MessageSquare, PartyPopper } from "lucide-react";
import TaskBoard from "./TaskBoard";
import FestivalBoard from "./FestivalBoard";
import WhatsAppApprovals from "../whatsapp-inbox/page";

type Tab = "board" | "team" | "festivals" | "whatsapp";

export default function TaskManagerPage() {
  const [tab, setTab] = useState<Tab>("board");
  const [waPending, setWaPending] = useState<number | null>(null);

  // Badge the approvals tab so nothing sits in the inbox unnoticed.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/whatsapp-inbox?status=new");
        if (!res.ok) return;
        const d = await res.json();
        setWaPending((d.items || []).length);
      } catch { /* badge is optional */ }
    })();
  }, [tab]);

  const tabs: { key: Tab; label: string; icon: typeof ListTodo; badge?: number | null }[] = [
    { key: "board", label: "Task Board", icon: ListTodo },
    { key: "team", label: "Team Tasks", icon: Users },
    { key: "festivals", label: "Festivals", icon: PartyPopper },
    { key: "whatsapp", label: "WhatsApp Approvals", icon: MessageSquare, badge: waPending },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <ListTodo className="w-6 h-6 text-indigo-400" /><span>Task Manager</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          The team&apos;s work and the client requests waiting on your approval — both in one place.
        </p>
      </div>

      <div className="flex flex-wrap bg-slate-950 border border-slate-900 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider w-fit max-w-full">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-2 ${
                tab === t.key ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              {!!t.badge && (
                <span className={`text-[9px] font-mono rounded-full px-1.5 py-0.5 ${
                  tab === t.key ? "bg-black/25 text-white" : "bg-emerald-950/60 border border-emerald-900 text-emerald-400"
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "board" && <TaskBoard mode="board" />}
      {tab === "team" && <TaskBoard mode="team" />}
      {tab === "festivals" && <FestivalBoard />}
      {tab === "whatsapp" && <WhatsAppApprovals />}
    </div>
  );
}
