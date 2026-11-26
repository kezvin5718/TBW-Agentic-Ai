"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";

const KEY = "tbw_beta";
const EVENT = "tbw-beta";

/**
 * Is this person looking at the beta layouts?
 *
 * Kept per person in localStorage, like day/night: the new layouts are tried
 * by whoever switches them on, and nobody else's screen moves. A page that has
 * a beta version reads this and draws it; a page that has none ignores it.
 */
export function useBeta(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { setOn(localStorage.getItem(KEY) === "on"); } catch { /* private mode */ }
    const sync = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return on;
}

/** The switch itself — beside day/night, in the corner that never moves. */
export default function BetaToggle() {
  const on = useBeta();
  const toggle = () => {
    const next = !on;
    try { localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* private mode */ }
    // The Beta theme itself (html.beta in globals.css) switches with it.
    document.documentElement.classList.toggle("beta", next);
    // Every mounted copy of the switch, and every page reading it, hears this.
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  };
  return (
    <button
      onClick={toggle}
      aria-pressed={on}
      title={on ? "Beta layouts are on — click to go back to the current design" : "Try the new beta layouts"}
      className={`h-11 lg:h-9 px-3 flex items-center gap-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
        on
          ? "bg-indigo-500 border-indigo-500 text-black"
          : "border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white"
      }`}
    >
      <FlaskConical className="w-4 h-4" />
      <span>Beta{on ? " on" : ""}</span>
    </button>
  );
}
