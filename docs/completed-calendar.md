# Completed work — a calendar, not a list

Founder (17 Sept, with screenshot): the Completed view currently pours every
finished task into one endless per-designer list (24 / 23 / 19 rows deep).
Wanted instead: **calendar based and designer based, date wise** — pick a day
on a real month calendar, see who finished what on that day. And the
reschedule count must be visible on every completed task, including zero.

## One component, used everywhere "completed" renders

New `CompletedCalendar` (inside
`src/app/dashboard/task-manager/TaskBoard.tsx` — keep the single-file
pattern; it may be a plain function component above `TaskBoard`).

**Top — the month:**
- Month header with ‹ month › arrows, "September 2026" style label. Default:
  the current IST month.
- A 7-column day grid (Mon–Sun header row). Every cell: the day number and,
  when anything was finished that day, a small emerald count badge. Days with
  nothing stay muted. Today gets a ring; the selected day gets the indigo
  fill. Days outside the month render blank.
- Clicking a day selects it (default selection: today when the month is the
  current one, otherwise nothing selected → hint "Pick a day").
- All day-bucketing in IST (Asia/Kolkata) via the file's existing helpers
  (`istDayOf` etc.) — never UTC.

**Below — the day, designer by designer:**
- For the selected day: groups per `assignee_name` (avatar + name + count,
  unassigned last), entries exactly like the existing strip rows — title,
  client chip, URGENT chip when urgent, the reschedule badge, IST finish
  time.
- **Reschedule badge in this view shows ALWAYS** — `↻ 0` in muted slate-600
  when zero (the founder must be able to answer "how many times was this
  pushed" for every task; zero is an answer). Elsewhere (open rows, team
  cards) the badge keeps hiding at zero. Give `RescheduleBadge` a
  `showZero?: boolean` prop rather than a second component.
- Empty selected day: "Nothing completed on this day."

**Data:** the component receives the done tasks it needs as a prop. The
existing `?status=done` fetch (limit 500) is enough — filter/bucket
client-side by month. Do not add API changes.

## Where it renders

1. **Team Tasks / board "Completed" tab** (`tab === "done"`, both modes):
   REPLACE the current rendering — the flat board list in board mode and the
   per-member columns in team mode — with `CompletedCalendar`. The endless
   columns of finished work go away entirely; the calendar is the completed
   view now.
2. **The board's "Completed — by designer" strip**: keep the collapsible
   header, but its body becomes the same `CompletedCalendar` (replacing the
   lone date input + groups). One component, one behaviour, everywhere.

Pending views (open tasks) are untouched — columns, drag-and-drop, the add
form, stats, everything.

## Rules

- No new dependencies, no API/schema changes.
- Keep indigo utilities (they render TBW yellow). Keep the file's comment
  voice. Mobile: the day grid must fit 390px (7 equal columns, compact
  cells, `min-h` touch targets on day buttons); no horizontal page scroll.
- Light theme: the app remaps slate/indigo tokens globally — use the same
  utility classes as the surrounding code and both themes follow.

## Acceptance

- Completed tab shows a month calendar with per-day counts; tapping 16 Sept
  shows that day's finishes grouped by designer; arrows reach August.
- Every completed entry shows ↻ N including ↻ 0.
- The strip and the Completed tab render identically (same component).
- Open-task views unchanged; `npm run build` exit 0.
