# Task Manager — urgent colours, completed strip, drag reassign, reschedule counter

Founder (16 Sept), confirmed decisions: existing priority `urgent` reads as
Urgent and everything else as Normal; only pushes to a LATER date count as a
reschedule; reassignment rights follow the existing "Can delete tasks"
pattern — a per-person checkbox in Team & Access (founder always may).

Schema is ALREADY APPLIED in production — do not write migrations:
- `tasks.reschedule_count int not null default 0`
- `profiles.can_move_tasks boolean not null default false`

## 1. Normal vs Urgent (colour is the feature)

- **Entry**: the add-task form and the edit modal replace the 4-level priority
  select with a two-button toggle: **Normal | Urgent** (Normal → priority
  `medium`, Urgent → `urgent`). Reading: `priority === "urgent"` is Urgent,
  anything else is Normal — old low/high rows keep working untouched.
- **Colour, in every view**: an Urgent task gets a rose treatment wherever a
  task renders — the board row (`oneLine`), the team-column cards, the
  completed strip: rose left edge / border tint on the card, the priority dot
  stays rose, plus a tiny `URGENT` chip (rose-950/40 bg, rose-400 text).
  Normal rows keep today's look exactly.

## 2. Completed strip, top of the board

- Board mode only, ABOVE the stat tiles: a collapsible section
  **"Completed — by designer"** (collapsed by default; remembers open/closed
  in localStorage, one key).
- Controls: a date input (default today, IST days — use the existing
  `fmtISTDate`/time helpers in src/lib/time.ts where they fit).
- Content: tasks with `status = done` whose `completed_at` falls on the chosen
  IST date, **grouped by `assignee_name`** (unassigned last), each group a
  small heading (avatar + name + count) and compact one-line entries: title,
  client chip, completion time, and the reschedule badge (see §4) when > 0.
- Data comes from the existing GET `/api/team-tasks?status=done` (it already
  returns completed tasks with `completed_at`; add `reschedule_count` to the
  GET select). Filter client-side by date.
- Empty state: "Nothing completed on this date."

## 3. Drag-and-drop reassignment (gated)

- **Permission**: mirror `mayDeleteTasks` exactly — new `mayMoveTasks(userId,
  role)`: founder always; employee only when `profiles.can_move_tasks`. GET
  `/api/team-tasks` response adds `canMove` beside the existing `canDelete`.
- **Server**: in the PATCH handler, when the patch would change the assignee
  (`assigneeName` present), require `mayMoveTasks` — 403 with a plain-English
  error otherwise. Assignee writes resolve `assignee_id` via the
  `team_members` ilike-name lookup the file already uses elsewhere (keep
  `assignee_id` and `assignee_name` in step — a name with no member row
  writes name + null id).
- **UI (Team Tasks columns)**: when `canMove`, each task card is `draggable`;
  the column is a drop target (highlight ring on dragover). Dropping a card
  on another member's column PATCHes `{ id, assigneeName: <that member> }` —
  optimistic move, reload on response. Only the staff name changes; nothing
  else on the task is touched. Dropping on its own column is a no-op.
  Native HTML5 DnD, no library. Without `canMove` nothing is draggable and no
  drop styling ever appears.
- **Edit modal**: the assignee select in the edit modal is shown only to
  users with `canMove` (it is the same act); others see the name read-only.
- **Team & Access page** (`src/app/dashboard/team/page.tsx` +
  `/api/team/route.ts`): a **"Can move tasks"** checkbox exactly beside "Can
  delete tasks" — same row style, same PATCH plumbing (`can_move_tasks`),
  same select list addition in the GET.

## 4. Reschedule via dates, counted, capped at 50

- **Server (PATCH)**: when the patch changes `deadline` to a LATER date than
  the task currently has (a null current deadline gaining one, or any move to
  an earlier date, does NOT count), increment `reschedule_count`. When
  `reschedule_count` is already ≥ 50 and the change would count, refuse with
  400: "This task has been rescheduled 50 times — it cannot be pushed again.
  Finish it or delete it." Compare dates as IST calendar days, not
  timestamps, so a time-of-day nudge on the same day is not a reschedule.
- **UI**: each open task row's expanded detail gets a small **deadline date
  input** (the row already shows the deadline; the input lives in the
  expanded `taskDetail`), so pushing to tomorrow is: expand, pick date. The
  edit modal's existing deadline field participates the same way (the server
  does the counting — the client never computes the count).
- **Badge**: wherever a task renders (board row, team card, completed strip):
  when `reschedule_count > 0`, a small mono badge `↻ N` (slate on normal
  rows, amber when N ≥ 10 — a task pushed ten times is a signal). Title
  attribute: "Rescheduled N time(s)". The badge persists on completed tasks.
- Add `reschedule_count` to every tasks select that feeds these views.

## Rules

- No new dependencies (native DnD). No schema changes beyond the two applied
  columns. Keep indigo utilities (they render TBW yellow). Keep each file's
  comment voice. Touch targets: the mobile pass patterns (`min-h-[40px]
  lg:min-h-0`) apply to any new control.
- Mobile: DnD is desktop-only by nature — on phones reassignment continues
  through the edit modal (gated the same way). New controls must not break
  the sideways-swiping team columns or the 390px board layout.

## Acceptance

- Add task as Urgent → rose card + URGENT chip on board, team column, and in
  staff view; Normal unchanged.
- Completed strip shows yesterday's finishes grouped per designer when the
  date is set back one day.
- Founder + checkbox-holders can drag a card between columns and only the
  name changes; a plain employee sees no drag affordance and the API refuses
  a forged PATCH.
- Pushing a deadline later increments the badge; earlier/same-day changes do
  not; the 51st push is refused with the plain error; the badge shows on the
  completed entry too.
- `npm run build` exit 0.
