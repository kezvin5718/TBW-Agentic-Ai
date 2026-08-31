# Navigation refactor — workstream IA, collapsible sidebar

An information-architecture refactor only. No route changes, no permission-key
changes, no page changes, no backend changes. `src/lib/sections.ts` and
`src/middleware.ts` are UNTOUCHED — visual grouping plays no part in
permissions, which is what makes this safe.

## The canonical map (one structure for everyone; labels, not routes, change)

| Section (order) | Items → existing route | Renames |
|---|---|---|
| **Home** | Command Centre → `/dashboard` | was "Console Home" |
| **Clients & Strategy** | Client Onboarding → `/dashboard/onboarding` · Brand Brain → `/dashboard/brand-brain` · Campaign Planning → `/dashboard/planning` | numbers dropped |
| **Work & Approvals** | Task Manager → `/dashboard/task-manager` · Call Notes → `/dashboard/calls` · **Approvals group**: Campaign Approvals → `/dashboard/approvals` (was "Approvals Flow"), Creative Approvals → `/dashboard/creatives-review` | the two approvals stay separate pages, visually nested under an "Approvals" sub-heading |
| **Creative Studio** | Style Library → `/dashboard/style-library` · Image Studio → `/dashboard/image-studio` · Content Hub → `/dashboard/content-hub` | |
| **Social & Content** | Content Planner → `/dashboard/production/plan-posts` (was "5b · Plan → Posts") · Festival & Moments Calendar → `/dashboard/festivals` (was "8b · Festivals") · Social Publisher → `/dashboard/social-publisher` | |
| **Paid Media** | Ad Publishing → `/dashboard/publishing` · Meta Ads Manager → `/dashboard/ads` · Catalogue Copy Studio → `/dashboard/ad-copy` (was "Catalogue Ad Copy") | |
| **Insights & Intelligence** | Insights & Reporting → `/dashboard/reporting` (was "Reporting & Analytics") · Agency Brain → `/dashboard/agency-brain` | |
| **AI & Automation** | Bron Assistant → `/dashboard/jarvis` · WhatsApp Reader → `/dashboard/whatsapp-reader` · Agent Console → `/dashboard/connections` (was "Agents Console") | |
| **Workspace & Admin** | Team & Access → `/dashboard/team` · Integrations → `/dashboard/settings/integrations` | |
| **Founder & Finance** | Accounting → `/dashboard/founder-zone/accounting` · Credit Logs → `/dashboard/credit-logs` | |

Feature numbers disappear from all labels (they live on in `sections.ts` keys,
which nobody sees). Each item keeps its current lucide icon; each section
header gets one muted icon.

## Config — `src/lib/navigation.ts` (new)

```ts
export interface NavItem {
  id: string; label: string; href: string; icon: string;   // lucide name
  roles: Array<"founder" | "employee" | "client">;
  badge?: "pendingSignups";        // extensible enum, not free components
  group?: string;                  // sub-heading inside a section ("Approvals")
}
export interface NavSection {
  id: string; label: string; icon: string; items: NavItem[];
}
export const NAVIGATION: NavSection[] = [ ...the table above... ];
```

Roles per item are copied EXACTLY from today's `allNavItems` (that is the
authority for who may see what; do not reinterpret). The layout keeps its
existing filtering — role check + employee `perms` via `sectionKeyForPath` —
now applied over the config; a section whose items all filter out is dropped
entirely, so "Founder & Finance" simply doesn't exist for non-founders and a
permission-trimmed employee never sees an empty heading.

## Sidebar behaviour (SidebarNav.tsx)

- Collapsible sections: header row (chevron rotates, `aria-expanded`,
  focusable button, Enter/Space toggles, visible focus ring).
- The ACTIVE page's section is always expanded (cannot be collapsed away
  while active — collapsing it is allowed, but navigation re-expands it).
- Active item: indigo accent + left bar/darkened row — not colour alone
  (weight/edge marker too). Requires `usePathname`; longest-prefix match so
  `/dashboard` doesn't light up everywhere.
- Manual expand/collapse state persisted (`localStorage`, one key, object of
  section ids). Default on first ever visit: only the active section open.
- The "Approvals" group inside Work & Approvals: a tiny muted sub-label above
  its two items, indented — not a second collapse level.
- Section headers visually secondary (uppercase, tracking, muted); items
  ≥40px targets, labels always visible; `<nav>` + list semantics.
- Mobile drawer: identical structure inside the existing drawer; the
  panel-mounted-twice pattern stays.

## Profile → avatar menu

- "My Profile" leaves the nav list. The user card (avatar + name) in the
  sidebar header becomes a menu trigger: **My Profile** (`/dashboard/profile`)
  and **Sign Out** (the existing `/auth/signout` POST form). No Preferences.
- AccountControls (top-right / mobile bar) keeps ONLY the theme toggle — its
  logout button is removed (it lives in the avatar menu now). One logout, one
  home.

## Also in this pass (display-only)

- Team & Access permission editor: where it displays section names from
  `sections.ts`, show the NEW labels (map key → new display name in the page,
  or add a `displayName` field to `sections.ts` entries WITHOUT touching
  keys/paths). Keys, grants and middleware untouched.

## Acceptance (from the founder's spec)

Every tool reachable · routes unchanged · numbers invisible · workstream
sections in the exact order · collapse + auto-expand + persistence · active
item obvious · permissions respected, empty sections hidden · profile in the
avatar menu · desktop + drawer both work · dark theme intact · config-driven.
```
