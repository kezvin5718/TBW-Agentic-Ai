"use client";

import { LogOut } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

/**
 * Day/night and Logout, kept where they can always be reached.
 *
 * Both used to sit at the foot of the sidebar, below twenty-five nav items —
 * a scroll on a desk, and on a phone a drawer to open and then scroll. These
 * are the two controls people reach for most, so they belong in the corner
 * that never moves.
 */
export default function AccountControls() {
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle compact />
      <form action="/auth/signout" method="POST" className="flex">
        <button
          type="submit"
          title="Logout"
          aria-label="Logout"
          className="w-11 h-11 lg:w-9 lg:h-9 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 hover:text-red-400 hover:bg-red-950/20 hover:border-red-950/50 cursor-pointer transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
