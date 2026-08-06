"use client";

import { useState } from "react";

/**
 * Shows public/tbw-logo.png if present, otherwise falls back to the
 * TBW / THE BRAND WAGON wordmark. Drop the logo file in and it appears
 * everywhere it's used — sidebar, login, pending — with no code change.
 *
 * `invert` white-ises the dark logo for dark surfaces (disabled in day view
 * via the .brand-logo-img rule in globals.css).
 */
export default function BrandLogo({
  height = 36,
  className = "",
  invert = true,
  stacked = true,
}: {
  height?: number;
  className?: string;
  invert?: boolean;
  stacked?: boolean;
}) {
  const [imgOk, setImgOk] = useState(true);

  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/tbw-logo.png"
        alt="TBW — The Brand Wagon"
        onError={() => setImgOk(false)}
        className={`brand-logo-img w-auto object-contain ${className}`}
        style={{ height, filter: invert ? "invert(1)" : undefined }}
      />
    );
  }

  const size = Math.round(height * 0.72);
  return (
    <div className={`leading-none ${className}`}>
      <span
        className="font-extrabold text-white tracking-[-0.07em] group-hover:text-[var(--yellow)] transition-colors"
        style={{ fontSize: size }}
      >
        TBW
      </span>
      {stacked && (
        <span
          className="block font-bold text-slate-500 tracking-[0.3em] uppercase mt-1"
          style={{ fontSize: Math.max(6.5, size * 0.22) }}
        >
          The Brand Wagon
        </span>
      )}
    </div>
  );
}
