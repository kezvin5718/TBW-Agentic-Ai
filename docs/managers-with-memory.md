# Phase 2 — Managers with Memory

The four morning managers (brand / design / content / social in
`src/lib/manager-brief.ts`) diagnose from scratch daily and remember nothing.
Phase 2 gives them a ledger: every finding becomes a tracked issue with an
identity and a lifecycle, the brief speaks in NEW / STILL OPEN / FIXED, and
the founder can silence what he has decided to live with.

## Data (the reviewer applies migrations — the developer never touches the DB)

```sql
create table manager_issues (
  key text primary key,          -- stable identity, e.g. 'missing_contact:<client_id>'
  manager text not null,         -- brand | design | content | social
  title text not null,           -- current human wording, refreshed each scan
  metric numeric,                -- today's count/size for this issue, when countable
  status text not null default 'open',  -- open | fixed | snoozed | accepted
  first_seen date not null,
  last_seen date not null,
  fixed_at date,
  snooze_until date,
  accepted_metric numeric,       -- metric at the moment of acceptance
  times_seen int not null default 1
);
create table manager_metrics (   -- daily series for trends (step 4)
  day date not null,
  key text not null,
  metric numeric,
  primary key (day, key)
);
```

## Step 1 — the scan reconciles instead of narrating

Refactor `collectNotes` so every check emits structured findings —
`{ manager, key, title, metric? }` — with **stable keys**:
`missing_contact:<client_id>`, `style_thin:<category>`, `style_empty`,
`qc_repeat:<client_id>`, `plan_contract_gap:<client_id>`,
`wa_unanswered:<client_id>`, `critic_fail:<client_id>`,
`captions_stuck:<client_id>`, `publish_fail:<client_id>`,
`festival_bare:<festival_id>`, `no_pipeline:<client_id>`.
The prose currently pushed into notes becomes each finding's `title` (same
wording, one finding per affected entity rather than one line naming eight).

Reconciliation, run inside the same morning job:
- emitted & no row → insert (open, first_seen = today)
- emitted & row open/snoozed-expired → last_seen = today, times_seen+1,
  title/metric refreshed; a snoozed row whose snooze_until has passed reopens
- emitted & snoozed (still in window) → refresh last_seen/metric, stay snoozed
- emitted & accepted → stays accepted UNLESS metric ≥ 2 × accepted_metric
  (both non-null), which reopens it — acceptance is not a blank cheque
- NOT emitted & row open/snoozed → status fixed, fixed_at = today
- every emitted finding also inserts (day, key, metric) into manager_metrics

## Step 2 — the brief reads the ledger

`composeBrief` (the Ochrester step) is fed structured sections instead of raw
notes:
- **NEW today** — first_seen = today
- **Still open** — grouped by age; each named once with "day N"; wording
  escalates only at day 7+ ("this has now been open a week")
- **Fixed since yesterday** — fixed_at = today, one line of credit
- **Accepted** — a single count ("4 accepted risks stay quiet"), never itemised
- An issue open ≥ 14 days with no founder action moves to accepted
  automatically (accepted_metric = current metric) and the brief says so once.
The Ochrester LLM compression stays, but its input is these sections, and its
instruction gains: never re-describe a Still-open item at full length —
one clause and its age.

## Step 3 — the founder's two buttons (built later, wave B)

`PATCH /api/manager-issues { key, action: 'snooze' | 'accept' | 'reopen',
days? }` — founder-only. Snooze sets snooze_until (default 3 days), accept
sets status accepted + accepted_metric = metric. The Agents Console manager
rail lists open issues for its manager with the two buttons.

## Step 4 — trends and the blind spots (built later, wave B)

- Monday brief: per manager, 2–3 week-over-week lines computed from
  manager_metrics (this-week sum vs last-week sum for the biggest keys).
- New checks, same framework: design → creatives sitting unreviewed > 3 days
  (`review_backlog:<client_id>`); content → hub tray rows untouched > 7 days
  (`tray_stale:<client_id>`); social → nothing; system-level (report under the
  manager most affected): OpenRouter balance below $10 (`credit_low`, brand),
  cron job quiet past its threshold (`cron_quiet:<job>`, reuse the
  /api/cron-health thresholds, report under social).
```
