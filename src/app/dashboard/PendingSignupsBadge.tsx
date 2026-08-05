"use client";

import { useEffect, useState } from "react";

/**
 * Amber count badge next to "Team & Access" showing how many signups are
 * waiting for approval. Polls every 60s; hidden when there's nothing pending.
 */
export default function PendingSignupsBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/team", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setCount(((data.users || []) as Array<{ approved: boolean }>).filter((u) => !u.approved).length);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (count === 0) return null;
  return (
    <span className="ml-auto relative flex items-center">
      <span className="absolute inline-flex h-4 w-4 rounded-full bg-amber-500 opacity-50 animate-ping" />
      <span className="relative inline-flex min-w-4 h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-black items-center justify-center">
        {count > 9 ? "9+" : count}
      </span>
    </span>
  );
}
