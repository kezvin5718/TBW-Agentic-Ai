"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/** Day/Night view switch — persisted per person in localStorage. */
export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tbw_theme") === "light";
      setLight(saved);
      document.documentElement.classList.toggle("light", saved);
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try { localStorage.setItem("tbw_theme", next ? "light" : "dark"); } catch { /* ignore */ }
  };

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
