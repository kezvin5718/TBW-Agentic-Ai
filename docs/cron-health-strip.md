# "Did everything run?" — the health strip

Answers the one question nothing in this portal currently answers: are the
nine background jobs still alive? Call Notes has never run in production and
nobody noticed, because no news looked like good news.

## What the study found

`cronSchedulerStatus.lastRun` already records every job's last run — **in
memory**, on `globalThis`. That makes it useless as a health record: every
deploy wipes it, so a perfectly healthy job reads as "never ran" minutes after
a release, and a job that genuinely died looks identical to one that is simply
young. A strip built on it would lie to the founder daily. **Last-run has to be
persisted**, which is why this spec starts with a table rather than a UI.

Second finding: the whole scheduler only starts when `CRON_ENABLED === "true"`
on the server. If that variable is missing, none of the nine jobs run at all,
and today nothing anywhere says so. The strip must show that state loudly
rather than rendering nine identical "never ran" rows.

## The nine jobs and how often they should be seen

| key | schedule (IST) | quiet after |
|---|---|---|
| `publishing` | every 15 min | 45 min |
| `wa_task_bot` | every 3 min | 20 min |
| `call_watcher` | every 5 min | 30 min |
| `ads_autopilot` | 06:00 daily | 26 h |
| `manager_brief` | 07:45 daily | 26 h |
| `morning_briefing` | 08:00 daily | 26 h |
| `overdue_digest` | 09:00 daily | 26 h |
| `storage_sweep` | 03:30 daily | 26 h |
| `weekly_learning_loop` | Sun 23:59 | 8 days |

"Quiet after" is deliberately generous — roughly three missed runs for the
frequent jobs, one missed day for the daily ones. An alarm that cries wolf gets
ignored, and being ignored is the failure this whole strip exists to prevent.

## Data — DONE

`cron_runs` table (migration applied on production):
`job text primary key, last_success_at timestamptz, last_status text,
last_note text, updated_at timestamptz default now()`.

## Work

### 1. src/lib/cron-scheduler.ts — record every run to the database

- Add a small `recordRun(job, status, note?)` helper: upserts `cron_runs` on
  `job`, setting `last_success_at` only when `status === "ok"` (so a failing
  job's last genuine success is not overwritten by its failures), always
  setting `last_status`, `last_note` and `updated_at`. Wrapped so a failed
  write can never break the job — the `logUsage` pattern in
  `src/lib/usage-log.ts` is the house style.
- Call it in every one of the nine jobs: `"ok"` where each already sets
  `cronSchedulerStatus.lastRun[...]`, and `"failed"` with the error message in
  each job's existing catch block. Keep the in-memory `lastRun` writes and all
  console logs exactly as they are.

### 2. New route: src/app/api/cron-health/route.ts

- `GET` — founder only (mirror the guard style of `/api/calls`).
- Returns `{ success, cronEnabled, schedulerRunning, jobs: [...] }` where
  `cronEnabled` is `process.env.CRON_ENABLED === "true"`, `schedulerRunning`
  is `cronSchedulerStatus.running`, and `jobs` is the nine known jobs (the
  table above, kept as a const in this file: key, human label, schedule text,
  quietAfterMs) left-joined onto their `cron_runs` row, each with a computed
  `state`:
  - `"off"` when `cronEnabled` is false — nothing is running, so no job can
    be judged
  - `"never"` when there is no row at all
  - `"failing"` when `last_status` is `"failed"`
  - `"quiet"` when `last_success_at` is older than its `quietAfterMs`
  - `"ok"` otherwise
- Include `lastSuccessAt` and `lastNote` per job so the UI can show them.

### 3. Console Home — the strip

Find the dashboard home page (`src/app/dashboard/page.tsx`). Add a compact
card, founder-only, titled "Background jobs". One row per job: a status dot
(emerald ok · amber quiet · rose failing · slate never), the job's label, its
schedule, and "last ok 4 min ago" (or "never"). Sort the unhealthy ones first
so a problem is the first thing read. When `cronEnabled` is false, replace the
list with a single amber line: "Scheduled jobs are switched off on the server
(CRON_ENABLED is not set) — nothing is running automatically." Refresh on
mount; no polling needed.

Match the existing dashboard card styling; keep it small — this is a glance,
not a report.

### 4. Verification

`npx tsc --noEmit` clean. The founder's real check is the strip after deploy:
frequent jobs should turn green within minutes, and `call_watcher` should read
"never" until Call Notes is actually launched — which is the strip telling the
truth on day one.
