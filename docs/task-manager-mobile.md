# Task Manager — mobile legibility pass

Founder's phone screenshots (10 Sept): the board works but is hard to read.
Three faults, all CSS/markup — no logic, API, or route changes.

## Fault 1 — task rows are sparse and dim on phones

`TaskBoard.tsx` `oneLine()` (~452–524): the desktop 12-col grid collapses on
mobile into a loose 3-line card where secondary text is 10px `slate-500/600/700`
on near-black — "1d ago", "no deadline", dates are nearly invisible.

Restructure the row **below `md:` only** (desktop grid stays byte-identical):

- **Line 1**: chevron + priority dot + title — title `text-[13px]`, source icon
- **Line 2**: client chip and assignee (avatar + name) left; assigned date +
  age right. Age reads `text-slate-400` (not 700), `text-[11px]`
- **Line 3**: deadline left (11px, red when overdue, `text-slate-400` when
  none); status select + edit/delete right
- Secondary text floor on mobile: `text-slate-400`, 11px. Titles white 13px.
- Touch targets: chevron, pencil, trash get `p-2` under `lg:` (existing
  `min-h-[40px] lg:min-h-0` pattern); status select ≥40px tall on mobile.
- Tighter card: `px-3 py-2.5`, internal `gap-y-1.5` — no dead vertical air.

## Fault 2 — header tabs wrap to two ragged lines

Task Manager page tab bar (Task Board / Team Tasks / Festivals / WhatsApp
Approvals + count): on phones it wraps. Make it one line, horizontally
scrollable: `flex overflow-x-auto no-wrap` with `shrink-0` pills and
`snap-x`; hide the scrollbar (existing utility if present). Desktop unchanged.

## Fault 3 — the Monitoring chip floats over content

`GlobalErrorMonitor.tsx` floating badge: on `<lg` screens show the compact
form — bug icon only, `p-2.5`, no "Monitoring" label (label back at `lg:`).
When issues exist, keep the count bubble + triangle icon and the issue count
text — errors must stay loud on any screen. Panel itself: cap width to
`calc(100vw-1.5rem)` so it never overflows a phone.

## Also, if trivially cheap (do not restructure for these)

- Stat tiles (`grid-cols-2 sm:grid-cols-4`): `p-4 → p-3` and value `text-2xl`
  under `sm:` so four tiles fit above the fold.
- Quick-add form inputs: ensure ≥40px tall, `text-sm` on mobile.

## Rules

- Dark theme only; keep indigo utilities (they render TBW yellow).
- Desktop (`md:` and up) must render exactly as today — this is a `<md` pass.
- No new deps, no state changes, no API calls touched.

## Acceptance

- 390px viewport: no horizontal page scroll; every piece of text on a task
  row legible (≥11px, ≥slate-400); tabs one line, scrollable; Monitoring chip
  compact and not covering row controls; desktop diff-invisible.
