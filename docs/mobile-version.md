# bron.digital on the phone — the mobile pass

## What the study found

- The dashboard shell (`src/app/dashboard/layout.tsx`) is already
  `flex-col lg:flex-row` — but below `lg` the WHOLE sidebar (25+ nav items)
  renders full-width ABOVE the page. On a phone you scroll through the entire
  menu before any content appears. This one flaw makes every screen feel
  broken; fixing it fixes half the app at once.
- 29 of the pages already use responsive Tailwind classes somewhere; ~10 wide
  tables/areas already sit in `overflow-x-auto`. The base is decent — this is
  a disciplined sweep, not a rebuild.
- Next.js App Router injects the standard viewport meta by default — nothing
  to add there.

## Ground rules (read twice)

1. **The desktop does not change.** Every fix is additive: mobile styles at
   the base, today's look restored at `lg:` (or `md:` where the page already
   uses it). If a diff would change what a desktop user sees, it's wrong.
2. **ClassName-level work only.** No business logic, no data fetching, no
   component rewrites — with the single exception of the Phase-1 drawer,
   which is a structural change to the shell and nothing else.
3. **One commit-sized batch per phase**, reported for review before the next.

## Phase 1 — the shell (the big win)

`src/app/dashboard/layout.tsx` is a server component; the drawer needs state,
so extract the sidebar's markup into a new client component
(`src/app/dashboard/SidebarNav.tsx`) that receives the already-computed nav
items, user display data and role styling as props. The server layout keeps
all its data fetching and passes props down.

Behaviour:
- **Below `lg`:** a slim top bar (logo left; hamburger right, 44px touch
  target). The nav renders as a slide-over drawer from the left — full height,
  `w-72 max-w-[85vw]`, dark backdrop behind it, closes on backdrop tap and on
  any nav-link tap. Body scroll locked while open.
- **At `lg` and up:** exactly today's fixed sidebar. Byte-identical markup
  goal: a desktop screenshot before and after should not differ.
- Content padding: `p-6 md:p-10` becomes `p-4 sm:p-6 md:p-10`.

## Phase 2 — screen sweeps, in staff-priority order

For each screen: stack grids on mobile (`grid-cols-1` base), let filter/button
rows wrap (`flex-wrap`), wrap any bare wide table in `overflow-x-auto`, keep
every tap target ≥40px, and make modals/panels full-width with internal scroll
below `sm`.

**Batch A — what staff open on phones daily:**
1. **Task Manager** (`task-manager/` + `TaskBoard.tsx`) — the board's columns
   must become horizontally swipeable on mobile: keep columns at a fixed
   `w-72` inside an `overflow-x-auto snap-x` row (desktop grid unchanged).
2. **WhatsApp Task Bar** (`whatsapp-inbox/`) — mostly cards already; ensure
   the tab strip + chips + sort row wraps, and action buttons wrap.
3. **Console Home** (`page.tsx` + its cards) — metric grids stack.
4. **Creative Approvals** (`creatives-review/`) — approval cards single-column,
   action buttons thumb-reachable.

**Batch B — heavy work screens:**
5. **Content Hub** (`content-hub/`)
6. **Social Publisher** (`social-publisher/`) — the biggest page; tabs,
   composer, Multi Story slots and the Library list all need the wrap/stack
   treatment.
7. **5b Plan → Posts** (`production/plan-posts/`)
8. **Credit Logs, Calls, Style Library** — smaller; tables scroll, grids stack.

Everything not listed (planning wizard, brand-brain, ads, reporting, admin
pages) is Batch C — same patterns, later, desk-first screens anyway.

## Phase 3 — verification

- `npx tsc --noEmit` clean per batch.
- Dev server + browser preview at 375×812: login page and layout shell
  verified directly; authed screens verified by static inspection of the
  diffs (the reviewer) and by the founder on a real phone after deploy —
  that's the sign-off that counts.
- The reviewer checks one desktop screenshot against production for the
  shell: no visible difference allowed.
