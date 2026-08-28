# The AI Project Manager — Stage A (suggest) with Stage B (assign) built dark

The routing knowledge already exists as months of rows in `tasks`: every
(client, task type) → assignee pair ever made. The AI Project Manager mines
that history, respects availability and load, and pre-fills every new task's
assignee with its reasoning shown. Stage B (assigning without asking) ships
behind a switch that stays OFF until the founder flips it.

## Data (reviewer applies; developer never touches the DB)

```sql
alter table team_members add column if not exists away_until date;
-- role_title stays the designation; department already exists.
-- Stage B switch lives in agency_settings key 'pm_auto_assign' ('on'/'off').
```

## Step 5 — the team gets availability

- Team management UI (find it — Team & Access at src/app/dashboard/team, or
  wherever team_members rows are edited; task-manager's Team tab shows them):
  each member gains an "Away until <date>" date control (clearable) writing
  `team_members.away_until`, shown as an amber "away till 30 Aug" chip
  wherever the member's name appears as an assignee option. role_title is
  surfaced as the designation everywhere it isn't already.

## Step 6 — the routing brain (pure data, no AI calls)

`src/lib/task-router.ts`:

```ts
export interface RouteSuggestion {
  teamMemberId: string | null; profileId: string | null; name: string;
  reason: string;          // "14 of this client's last 16 design tasks · load 8"
  confidence: "high" | "medium" | "low";
  alternates: { name: string; reason: string }[];   // up to 2
}
export async function suggestAssignee(input: {
  clientId?: string | null; taskType?: string | null;
}): Promise<RouteSuggestion | null>
```

Scoring, from `tasks` (last 180 days, service role):
- +3 per task done for SAME client AND same type, +2 same client any type,
  +1 same type any client — each × recency weight (task in last 30 days
  counts full, older half)
- normalise per candidate; exclude members inactive or away
  (away_until ≥ today); exclude candidates with zero history
- subtract a load penalty: open (status != done) task count × 0.5
- confidence: high when the winner has ≥ 8 weighted points AND ≥ 1.5× the
  runner-up; medium when it merely wins; low when history is thin (< 3
  relevant tasks) — low returns the least-loaded member of the matching
  department instead, reason saying so
- `GET /api/task-router?clientId=&taskType=` — staff-guarded thin wrapper,
  used by the UIs and testable by hand.

## Step 7 — suggestions everywhere a task is born

- **WhatsApp drafts** (TaskDrafts approve flow): the assignee select
  pre-selects the suggestion; small slate line under it with the reason.
  The bot's own `suggested_assignee` remains a fallback when the router
  returns null.
- **Festival rows** (FestivalBoard): when a client row's member select is
  still empty, show a ghost "suggest: <name>" chip; clicking it applies.
  (No auto-apply — festival assignment is a deliberate founder act.)
- **Manual add** (TaskBoard's create/edit modal): when client or type
  changes and assignee is empty, fetch and pre-select, reason underneath.
- Every surface passes taskType where it knows it; clientId where it knows
  it; the router copes with either missing.

## Step 8 — member pattern profiles (wave E)

`GET /api/team-profile` (staff): per active member, computed live from
tasks/creatives (last 60 days): open load, done count, on-time %,
median days-to-done by type, QC pass rate of their creatives (match by
assignee on the task the creative came from where linkable; skip when not),
top 3 clients by task count. Team tab renders a compact card per member.

## Step 9 — Stage B, dark (wave E)

- agency_settings `pm_auto_assign`: 'off' (default) / 'on'. A founder-only
  toggle in the team UI, plainly labelled.
- When ON: a task created WITHOUT an assignee (WhatsApp draft approval,
  festival add, sheet scan) asks the router; only a HIGH-confidence answer
  assigns (writing assignee_id + assignee_name); anything else stays
  unassigned. Every auto-assignment writes a row into the manager ledger
  framework as key `pm_auto:<task_id>` (manager 'social'… no — a fifth
  manager key 'pm' with title "Auto-assigned: <task> → <name>", auto-fixed
  next morning) so the morning brief carries "PM assigned N tasks yesterday".
  Keep the ledger integration minimal — one insert per assignment, marked
  fixed by the next scan.
- When OFF (default): behaviour identical to Stage A. The switch is the only
  difference.
```
