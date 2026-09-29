# Story repeat — one upload, many days

Founder (29 Sept): the team schedules the same story creative on many days,
and today that means uploading the identical file to Content Hub once per
day. Wanted: upload ONCE, then choose **Everyday / Alternate days / Manual**
— dates and time auto-adjust from the first slot.

The repeat lives where the dates live: the Social Publisher **Automation**
list. One `creative_uploads` row fans out into many scheduled posts. Content
Hub upload is untouched; QC runs once.

## Files

- `src/app/dashboard/social-publisher/page.tsx` (automation row controls +
  send payload)
- `src/app/api/social-publisher/automation/route.ts` (POST expands repeats)

## UI — automation rows, STORIES only

On each automation row whose `content_type === "story"` (Clear and Risk mode
alike), beside the existing date + time slot:

- a **Repeat** select: `Manual` (default) | `Everyday` | `Alternate days`
- when not Manual, a **times** number input, 2–30, default 7, labelled `× N`
- a muted preview line under the row's slot when repeating:
  "Runs N times · <first IST date> → <last IST date> · same time daily" (or
  "every 2nd day"). Compute last date client-side: first date + (N−1)×step
  days, step 1 or 2.
- Repeat state lives beside the schedule slot state (keyed by row id, reset
  the same way the slots reset on client change / reload).
- The existing collision (`autoCollisions`) and out-of-order checks keep
  operating on the FIRST slot only — repeats never trip them (they land on
  later days by construction).

## API — POST expansion

Each `items[]` entry may now carry `repeat?: { mode: "everyday" | "alternate";
times: number }` (absent = today's behaviour, exactly).

Server rules:
- Validate: mode one of the two; times an integer clamped to 2–30; repeat
  only honoured when the upload's `content_type` is `"story"` — anything else
  ignores it silently (defensive, the UI never sends it).
- Expansion: occurrence k (k = 0 … times−1) is the item's `scheduledFor`
  plus `k × (mode === "everyday" ? 1 : 2)` days — SAME wall-clock time, IST.
  `scheduledFor` arrives as `"YYYY-MM-DDTHH:mm"`; add days to the date part
  as a calendar-day string operation (Date.UTC on the Y/M/D parts, then
  slice), never by adding milliseconds to the converted UTC instant.
- Each occurrence goes through the existing per-platform send loop exactly
  as if it were its own item (RecurPost call, social_posts row with its own
  `scheduled_for`, `[automation]`/`[risk-override]` webhook note). The
  simplest faithful shape: expand `items` into occurrences BEFORE the loop
  (same uploadId, same caption, shifted scheduledFor) and let the loop run
  unchanged.
- The upload is marked `scheduled` once (existing `doneUploads` set handles
  this — anyOk from any occurrence). Risk stamping unchanged.
- Videos: the Drive pre-flight and staging already run per upload URL; the
  staged URL is computed once per upload (it already is, per item — make
  sure expansion doesn't stage the same video N times: stage per unique
  uploadId, reuse the URL across its occurrences).
- Response `scheduled`/`posts` counts: posts counts occurrences × platforms
  as it naturally will; add `occurrences` total so the UI toast can say
  "story scheduled 7 times".

## Rules

- No schema changes, no new dependencies. Keep indigo utilities (TBW
  yellow). Keep both files' comment voices. Mobile: the new controls wrap
  and keep `min-h-[40px] lg:min-h-0`.
- Festival stories (self-scheduling via Content Hub) are untouched.

## Acceptance

- A story row set to Everyday × 7 at 19:00 on 1 Oct sends once and creates 7
  social_posts per platform: 1–7 Oct, all 19:00 IST; the creative shows
  `scheduled` and leaves the list. Alternate × 5 → 1, 3, 5, 7, 9 Oct.
- Manual (default) behaves byte-for-byte as today; posts/reels rows show no
  repeat control.
- A Drive video story stages once, not N times.
- `npm run build` exit 0.
