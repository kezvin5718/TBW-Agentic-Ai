/**
 * Everything the agency does runs on India Standard Time (Asia/Kolkata).
 *
 * Two things kept drifting before this file existed:
 *  1. The server runs in a Docker container with no TZ set, so it defaulted to
 *     UTC. Anything the server formatted or parsed came out 5:30 behind.
 *  2. `new Date("2026-08-06T15:00")` — a datetime-local value with no zone —
 *     is parsed in whatever timezone the *runtime* is in. On the browser that's
 *     IST; on the server it was UTC. Same string, two different instants.
 *
 * So: store instants as UTC (ISO), and use these helpers at every boundary
 * where a human-facing wall clock is read or written. IST is a fixed +05:30
 * with no daylight saving, which is what makes the offset constant safe.
 */

export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/**
 * A wall-clock string the team typed ("2026-08-06T15:00" or "2026-08-06 15:00")
 * means 3pm *in India* — never 3pm UTC. Returns the matching instant.
 */
export function istWallClockToUtc(local: string): Date {
  const s = String(local).trim().replace(" ", "T");
  // Already carries a zone (Z or ±hh:mm)? Trust it.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
  const withSeconds = /T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
  return new Date(`${withSeconds}${IST_OFFSET}`);
}

/** The instant as an IST wall clock: "2026-08-06 15:00:00". */
export function utcToIstWallClock(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function istParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) out[part.type] = part.value;
  // en-GB renders midnight as "24" — normalise it.
  if (out.hour === "24") out.hour = "00";
  return out as { year: string; month: string; day: string; hour: string; minute: string; second: string };
}

/** Today in IST as "YYYY-MM-DD" — safe for <input type="date"> defaults and mins. */
export function istToday(): string {
  const p = istParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A calendar date N days from today in IST, as "YYYY-MM-DD" (negative = past).
 * Rolling windows ("yesterday", "last 14 days") must be counted on the Indian
 * calendar — counted in UTC they slip a day for anyone working before 5:30am.
 */
export function istDateOffset(days: number): string {
  const [y, m, d] = istToday().split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Current IST clock as "HH:MM:SS" — for issue logs and anything the team reads. */
export function istClock(d: Date = new Date()): string {
  const p = istParts(d);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Display an instant in IST, e.g. "6 Aug 2026, 15:00". */
export function fmtIST(d: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    timeZone: IST_TZ,
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...opts,
  });
}

/** Date only, in IST — "6 Aug 2026". */
export function fmtISTDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { timeZone: IST_TZ, day: "numeric", month: "short", year: "numeric" });
}
