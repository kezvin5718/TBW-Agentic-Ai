"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";

/**
 * Status control on a Console Home task card. Lets a designer or manager move
 * their own work along without needing access to the full Task Manager board.
 */
export default function MyTaskCard({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  const save = async (next: string) => {
    setBusy(true);
    const previous = value;
    setValue(next);
    try {
      const res = await fetch("/api/team-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      if (!res.ok) throw new Error("save failed");
      if (next === "done") setGone(true);
    } catch {
      setValue(previous);
    } finally {
      setBusy(false);
    }
  };

  if (gone) {
    return <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Marked done</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
      ) : (
        <>
          <select
            value={value}
            onChange={(e) => save(e.target.value)}
            className="text-[9px] font-bold bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-slate-300 cursor-pointer focus:outline-none"
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>
          <button
            onClick={() => save("done")}
            title="Mark done"
            className="p-1 rounded-md bg-emerald-950/40 border border-emerald-900 text-emerald-400 hover:bg-emerald-900/40 cursor-pointer"
          >
            <Check className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
}
