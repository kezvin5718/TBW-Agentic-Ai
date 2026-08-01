"use client";

import { useEffect, useState } from "react";

type DiagStatus = "unknown" | "running" | "ok" | "warn" | "fail" | "error";

/**
 * Small live health dot rendered next to the "System Diagnostics" sidebar item.
 * Reflects the last diagnostics run (persisted in localStorage) and pulses while a
 * test is running — updated in real time via the "tbw-diag-status" window event.
 */
export default function DiagnosticsStatusDot() {
  const [status, setStatus] = useState<DiagStatus>("unknown");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tbw_diag_status") as DiagStatus | null;
      if (saved) setStatus(saved);
    } catch {
      /* ignore */
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as DiagStatus;
      if (detail) setStatus(detail);
    };
    window.addEventListener("tbw-diag-status", handler);
    return () => window.removeEventListener("tbw-diag-status", handler);
  }, []);

  const map: Record<DiagStatus, { color: string; title: string; pulse: boolean }> = {
    unknown: { color: "bg-slate-600", title: "Not run yet", pulse: false },
    running: { color: "bg-indigo-400", title: "Testing…", pulse: true },
    ok: { color: "bg-emerald-400", title: "All systems OK", pulse: false },
    warn: { color: "bg-amber-400", title: "Warnings found", pulse: false },
    fail: { color: "bg-rose-500", title: "Failures found", pulse: true },
    error: { color: "bg-rose-500", title: "Diagnostics error", pulse: true },
  };
  const s = map[status];

  return (
    <span className="relative ml-auto flex items-center" title={s.title}>
      {s.pulse && <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full ${s.color} opacity-50 animate-ping`} />}
      <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${s.color}`} />
    </span>
  );
}
