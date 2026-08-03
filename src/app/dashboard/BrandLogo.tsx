"use client";

import { useState } from "react";

/**
 * Shows public/tbw-logo.png if present (inverted to white for the dark sidebar),
 * otherwise falls back to the TBW / The Brand Wagon wordmark. Drop the logo file
 * in and it appears automatically — no code change needed.
 */
export default function BrandLogo() {
  const [imgOk, setImgOk] = useState(true);

  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/tbw-logo.png"
        alt="TBW — The Brand Wagon"
        onError={() => setImgOk(false)}
        className="h-9 w-auto max-w-[150px] object-contain"
        style={{ filter: "invert(1)" }}
      />
    );
  }

  return (
    <div className="leading-none">
      <span className="font-extrabold text-2xl text-white tracking-[-0.07em] group-hover:text-[var(--yellow)] transition-colors">TBW</span>
      <span className="block text-[7.5px] font-bold text-slate-500 tracking-[0.3em] uppercase mt-1">The Brand Wagon</span>
    </div>
  );
}
