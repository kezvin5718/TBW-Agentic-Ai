"use client";

import ThemeToggle from "./ThemeToggle";

/**
 * Day/night, kept where it can always be reached.
 *
 * It used to sit at the foot of the sidebar, below twenty-five nav items — a
 * scroll on a desk, and on a phone a drawer to open and then scroll. So it
 * lives in the corner that never moves. Logout used to sit beside it; there is
 * one way out now and it is in the avatar menu, with the profile.
 */
export default function AccountControls() {
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle compact />
    </div>
  );
}
