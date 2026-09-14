# Festival allotment — one step, no typing

Founder (14 Sept): allotting a festival should be a single act — pick the
festival, pick the clients, pick the designer for each, optionally give a
tagline — and the tasks make themselves. Today the Festivals tab adds clients
bare and someone assigns/taglines each row afterwards; the founder wants the
whole decision made in the Add panel. Approved decisions: deadline lands
**2 days before** the festival; **per-client designer** with a
"same designer for all" shortcut; **per-client tagline**, optional.

## API — `/api/festival-tasks` POST (src/app/api/festival-tasks/route.ts)

New body shape, alongside the old one (both accepted):

```
{ festivalId, clients: [{ clientId, teamMemberId?, tagline? }] }
{ festivalId, clientIds: [...] }        // legacy — behaves exactly as today
```

- Dedupe/skip-already-on-festival logic unchanged.
- **Deadline**: `festival.scheduled_at` minus 2 days. Never in the past —
  clamp to now when the festival is closer than 2 days. No `scheduled_at`
  still means +7 days from now.
- When an entry carries `teamMemberId`: resolve the member (name +
  `profile_id` — tasks.assignee_id is a PROFILE id, the PATCH handler shows
  the pattern), write `assignee_name`/`assignee_id` on the task at insert,
  and `team_member_id`/`assignee_name` on the festival row at insert.
- When an entry carries `tagline` (trimmed, ≤300, else null): write it to
  `festival_tasks.tagline` AND `tasks.description` — same dual write the
  PATCH does, so the designer reads it on their own board.
- `autoAssignTask` (PM suggestion) runs ONLY for entries that arrived with no
  `teamMemberId` — a designer chosen by a person is never second-guessed.
- Response unchanged (`{ success, added, message }`).

## UI — Add panel (src/app/dashboard/task-manager/FestivalBoard.tsx)

The existing panel keeps its search + client chips. Below the chips, every
picked client becomes an **allotment row**:

- client name
- designer `<select>` — "Assign to…" default, team list with the existing
  `awayLabel` suffixes; next to it the existing dashed `suggest: <name>`
  button (from `fetchSuggestion(clientId, "design")`, reusing the component's
  suggestion cache) which fills the select when clicked — suggestions stay
  clickable, never pre-applied
- tagline `<input>` — placeholder "Tagline (optional)…"

Above the rows, when ≥2 clients are picked: one "Same designer for all"
select that sets every row's designer in one go (rows can still be changed
individually after).

The Add button submits the new body shape. Un-picking a client drops its row
(state keyed by clientId, so re-picking starts clean). Existing board rows,
PATCH editing, DELETE, statuses — all untouched.

Mobile: rows wrap, controls keep the `min-h-10` targets the file already
uses.

## Rules

- No schema changes — every column already exists.
- Keep indigo utilities (they render TBW yellow).
- Keep the file's comment voice.
- Suggestion etiquette stays as the file states: festival work is assigned on
  purpose; suggestions wait to be clicked.

## Acceptance

- Pick festival → pick 3 clients → give 2 a designer, 1 a tagline → Add: 3
  tasks appear on the Task Board, 2 pre-assigned (visible in that designer's
  My Tasks), the tagline readable on the task, deadlines 2 days before the
  festival date.
- Legacy add (no designers) behaves exactly as before, PM suggestion
  included.
- A festival 1 day away yields a deadline of today, not yesterday.
- `npm run build` exits 0.
