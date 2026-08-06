"use client";

import { useState } from "react";

/**
 * A staff member's photo wherever their name appears. Falls back to their
 * initials on a colour derived from the name, so two people never look alike
 * and nobody is ever a blank grey circle.
 */
const TONES = [
  "bg-indigo-900/50 border-indigo-700/60 text-indigo-200",
  "bg-emerald-900/50 border-emerald-700/60 text-emerald-200",
  "bg-amber-900/50 border-amber-700/60 text-amber-200",
  "bg-pink-900/50 border-pink-700/60 text-pink-200",
  "bg-cyan-900/50 border-cyan-700/60 text-cyan-200",
  "bg-violet-900/50 border-violet-700/60 text-violet-200",
];

function toneFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i)) % TONES.length;
  return TONES[n];
}

export function initialsOf(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({
  name,
  url,
  size = 36,
  rounded = "rounded-lg",
  className = "",
  title,
}: {
  name?: string | null;
  url?: string | null;
  size?: number;
  rounded?: string;
  className?: string;
  title?: string;
}) {
  const [broken, setBroken] = useState(false);
  const label = title ?? name ?? "";

  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name || "Profile photo"}
        title={label}
        onError={() => setBroken(true)}
        className={`${rounded} object-cover border border-slate-800 shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      title={label}
      className={`${rounded} border flex items-center justify-center font-bold shrink-0 ${toneFor(name || "?")} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initialsOf(name)}
    </div>
  );
}
