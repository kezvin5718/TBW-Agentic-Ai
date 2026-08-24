"use client";

import { useState, useEffect } from "react";
import { Activity, Loader2 } from "lucide-react";

/**
 * "Did everything run?" — the one question Console Home could not answer.
 *
 * Call Notes had never run in production and nobody noticed, because no news
 * looked like good news. This is a glance, not a report: nine dots, worst
 * first, so a dead job is the first thing read and a healthy board costs one
 * second to confirm.
 */
interface Job {
  key: string;
  label: string;
  schedule: string;
  state: string;
  lastSuccessAt: string | null;
  lastNote: string | null;
}

const DOT: Record<string, string> = {
  ok: "bg-emerald-400",
  quiet: "bg-amber-400",
  failing: "bg-rose-500",
  never: "bg-slate-600",
};
// Trouble first. A green job is worth a glance; a red one is worth the top row.
const ORDER: Record<string, number> = { failing: 0, quiet: 1, never: 2, ok: 3 };

/** "last ok 4 min ago" — the plain answer, not a timestamp to decode. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 60) return `last ok ${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `last ok ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `last ok ${hours}h ago`;
  return `last ok ${Math.round(hours / 24)}d ago`;
}

export default function CronHealthCard() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [cronEnabled, setCronEnabled] = useState(true);
  const [failedToRead, setFailedToRead] = useState(false);

  // Once, on mount. These jobs are measured in minutes and days — polling a
  // strip like this would cost more than it could ever tell anyone.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/cron-health", { cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        const data = await res.json();
        if (!alive) return;
        setCronEnabled(data.cronEnabled !== false);
        setJobs(data.jobs || []);
      } catch {
        if (alive) setFailedToRead(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const sorted = jobs ? [...jobs].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9)) : [];

  return (
    <div className="bg-slate-955/20 border border-slate-900 rounded-2xl p-5 space-y-4">
      <h3 className="text-sm font-bold text-white flex items-center space-x-1.5 border-b border-slate-900 pb-2">
        <Activity className="w-4 h-4 text-indigo-400" />
        <span>Background jobs</span>
      </h3>

      {failedToRead ? (
        <p className="text-[10px] text-slate-500 py-2">Couldn&apos;t read the job history just now.</p>
      ) : !jobs ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 text-slate-600 animate-spin" /></div>
      ) : !cronEnabled ? (
        <p className="text-[11px] text-amber-300 leading-snug">
          Scheduled jobs are switched off on the server (CRON_ENABLED is not set) — nothing is running automatically.
        </p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((j) => (
            <div key={j.key} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[j.state] || "bg-slate-600"}`} />
                <span className="font-bold text-slate-300 truncate" title={j.lastNote || undefined}>{j.label}</span>
                <span className="text-slate-600 font-mono shrink-0">{j.schedule}</span>
              </span>
              <span className={`font-mono shrink-0 ${j.state === "failing" ? "text-rose-400" : j.state === "quiet" ? "text-amber-400" : "text-slate-500"}`}>
                {ago(j.lastSuccessAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
