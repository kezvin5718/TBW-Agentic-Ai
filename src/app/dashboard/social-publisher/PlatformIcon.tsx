"use client";

/**
 * Small brand marks for the publishing calendar. Lucide dropped its brand
 * icons, so these are drawn inline — no network fetch, and they stay readable
 * down to 10px where the calendar needs them.
 */
export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

export const PLATFORM_COLOR: Record<string, string> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
  pinterest: "#E60023",
};

/** "Instagram Reel", "Facebook Post" — the name the social team uses. */
export function postLabel(platform: string, contentType: string): string {
  const p = PLATFORM_LABEL[platform] || platform;
  const t = contentType.charAt(0).toUpperCase() + contentType.slice(1);
  return `${p} ${t}`;
}

export default function PlatformIcon({ platform, size = 12 }: { platform: string; size?: number }) {
  const color = PLATFORM_COLOR[platform] || "#94a3b8";
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: color, "aria-hidden": true };

  switch (platform) {
    case "instagram":
      return (
        <svg {...common}>
          <path d="M12 2c2.7 0 3.1 0 4.1.06 1 .05 1.7.2 2.3.44.6.24 1.1.55 1.6 1.05.5.5.81 1 1.05 1.6.24.6.39 1.3.44 2.3.06 1 .06 1.4.06 4.1s0 3.1-.06 4.1c-.05 1-.2 1.7-.44 2.3a4.4 4.4 0 0 1-1.05 1.6c-.5.5-1 .81-1.6 1.05-.6.24-1.3.39-2.3.44-1 .06-1.4.06-4.1.06s-3.1 0-4.1-.06c-1-.05-1.7-.2-2.3-.44a4.4 4.4 0 0 1-1.6-1.05 4.4 4.4 0 0 1-1.05-1.6c-.24-.6-.39-1.3-.44-2.3C2.05 15.1 2 14.7 2 12s0-3.1.06-4.1c.05-1 .2-1.7.44-2.3.24-.6.55-1.1 1.05-1.6.5-.5 1-.81 1.6-1.05.6-.24 1.3-.39 2.3-.44C8.9 2 9.3 2 12 2Zm0 1.8c-2.67 0-2.99.01-4.04.06-.98.04-1.5.2-1.86.34-.47.18-.8.4-1.15.75-.35.35-.57.68-.75 1.15-.14.36-.3.88-.34 1.86-.05 1.05-.06 1.37-.06 4.04s.01 2.99.06 4.04c.04.98.2 1.5.34 1.86.18.47.4.8.75 1.15.35.35.68.57 1.15.75.36.14.88.3 1.86.34 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.98-.04 1.5-.2 1.86-.34.47-.18.8-.4 1.15-.75.35-.35.57-.68.75-1.15.14-.36.3-.88.34-1.86.05-1.05.06-1.37.06-4.04s-.01-2.99-.06-4.04c-.04-.98-.2-1.5-.34-1.86a3.1 3.1 0 0 0-.75-1.15 3.1 3.1 0 0 0-1.15-.75c-.36-.14-.88-.3-1.86-.34-1.05-.05-1.37-.06-4.04-.06Zm0 3.07a5.13 5.13 0 1 1 0 10.26 5.13 5.13 0 0 1 0-10.26Zm0 1.8a3.33 3.33 0 1 0 0 6.66 3.33 3.33 0 0 0 0-6.66Zm5.34-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <path d="M23.5 6.2a3 3 0 0 0-2.12-2.12C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.53A3 3 0 0 0 .5 6.2C0 8.08 0 12 0 12s0 3.92.5 5.8a3 3 0 0 0 2.12 2.12c1.88.53 9.38.53 9.38.53s7.5 0 9.38-.53a3 3 0 0 0 2.12-2.12C24 15.92 24 12 24 12s0-3.92-.5-5.8ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
        </svg>
      );
    case "pinterest":
      return (
        <svg {...common}>
          <path d="M12 0a12 12 0 0 0-4.37 23.18c-.06-.94-.01-2.07.23-3.09l1.5-6.36s-.37-.75-.37-1.85c0-1.74 1-3.03 2.26-3.03 1.07 0 1.58.8 1.58 1.76 0 1.07-.68 2.67-1.04 4.16-.3 1.24.62 2.26 1.85 2.26 2.22 0 3.93-2.34 3.93-5.72 0-2.99-2.15-5.08-5.22-5.08-3.56 0-5.64 2.67-5.64 5.42 0 1.07.41 2.23.93 2.85.1.13.12.24.09.37l-.35 1.42c-.05.23-.18.28-.42.17-1.57-.73-2.55-3.02-2.55-4.86 0-3.96 2.87-7.59 8.29-7.59 4.35 0 7.73 3.1 7.73 7.25 0 4.32-2.72 7.8-6.5 7.8-1.27 0-2.46-.66-2.87-1.44l-.78 2.98c-.28 1.09-1.05 2.45-1.56 3.28A12 12 0 1 0 12 0Z" />
        </svg>
      );
    default:
      return <span style={{ width: size, height: size, display: "inline-block", background: color, borderRadius: 2 }} />;
  }
}
