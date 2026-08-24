"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Day/Night view switch — persisted per person in localStorage.
 *
 * `compact` is the same switch as an icon-sized button, for the account cluster
 * in the top-right corner where there is no room for a labelled block.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tbw_theme") === "light";
      setLight(saved);
      document.documentElement.classList.toggle("light", saved);
    } catch { /* ignore */ }
  }, []);

  // The switch is mounted twice now — once in the desktop strip, once in the
  // mobile bar — and only one of them is ever on screen. Without this the
  // hidden one keeps the state it had at mount, and crossing the lg breakpoint
  // reveals a sun sitting on a page that is already light.
  useEffect(() => {
    const sync = (e: Event) => setLight((e as CustomEvent<boolean>).detail);
    window.addEventListener("tbw-theme", sync);
    return () => window.removeEventListener("tbw-theme", sync);
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("light");
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try { localStorage.setItem("tbw_theme", next ? "light" : "dark"); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("tbw-theme", { detail: next }));
  };

  if (compact) {
    return (
      <button
        onClick={toggle}
        title={light ? "Switch to night view" : "Switch to day view"}
        aria-label={light ? "Switch to night view" : "Switch to day view"}
        className="w-11 h-11 lg:w-9 lg:h-9 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white cursor-pointer transition-colors"
      >
        {light ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-[var(--yellow)]" />}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={light ? "Switch to night view" : "Switch to day view"}
      className="w-full mb-2 flex items-center justify-center gap-2 py-2 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white text-xs font-bold cursor-pointer transition-colors"
    >
      {light ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-[var(--yellow)]" />}
      <span>{light ? "Night view" : "Day view"}</span>
    </button>
  );
}
