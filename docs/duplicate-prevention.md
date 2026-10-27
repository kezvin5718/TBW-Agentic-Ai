# Duplicate posting prevention — one creative, one account, one slot, one post

Founder (27 Oct, confirmed): every send path reserves its slot in the
database BEFORE calling RecurPost, so double-clicks, two people at once and
blind retries can never produce two posts. Reposts on a different date/time
and the same creative on different accounts stay allowed. "Post now" sends:
the same creative to the same account within 10 minutes = duplicate.
RecurPost has no delete/cancel API and sends no webhooks — confirmed
duplicates are flagged "manual removal required", never auto-deleted.

Schema ALREADY APPLIED on social_posts — no migrations:
- status now allows `sending` and `uncertain` (plus sent/failed/published)
- `social_account_id text`, `dedupe_key text`, `duplicate_of uuid →
  social_posts`, `duplicate_detected_at`, `duplicate_resolution_status`
  ('manual_removal_required'|'resolved'|'ignored')
- UNIQUE partial index `social_posts_dedupe_live` on dedupe_key where
  dedupe_key is not null and status in (sending, sent, published, uncertain).
  A failed row releases its key (failed is outside the index) so a genuine
  retry is possible. Old rows have null keys and never block anything.
- 41 historical duplicates ALREADY flagged (duplicate_of + manual_removal_required).

## The helper — new `src/lib/post-dedupe.ts`

- `mediaIdentity(url)`: collapse every form of one file to one identity —
  lh3 `/d/<ID>`, `drive.google.com/file/d/<ID>`, and the staged mirror
  `studio-outputs/social/drive-<ID>.<ext>` all → `drive:<ID>`; any other URL
  → its path without query string.
- `dedupeKey({ clientId, accountId, platform, contentType, mediaUrl,
  scheduledIso })` → `client|account|platform|type|identity|slot` where slot
  is the scheduled ISO minute, or `now:<floor(epochMs/600000)>` for no schedule.
- `reserve(admin, row)`: inserts the social_posts row with status `sending`,
  its dedupe_key and social_account_id. On unique violation (23505) returns
  `{ duplicate: true, existing }` (fetch the live row holding the key). For
  "now" sends, ALSO pre-check any live row with the same key minus slot and
  created_at within the last 10 minutes (covers the bucket boundary) →
  duplicate. Returns `{ duplicate: false, id }` otherwise.
- `settle(admin, id, outcome)`: updates the reserved row to `sent` (with
  recurpost_post_id, webhook_response) or `failed`, or `uncertain` when the
  RecurPost call threw/timed out/returned non-JSON — note: "RecurPost did not
  answer clearly — check its Queue before resending."

## Wire EVERY send path (reserve → postContent → settle)

Today each path calls postContent then inserts the social_posts row. Flip it:
reserve first, call RecurPost only when the reservation is ours, settle after.
Paths: `src/app/api/social-publisher/route.ts` (composer POST and the Library
retry/edit-resend PATCH), `automation/route.ts` POST occurrence loop
(including story/linked-story/carousel occurrences), `bulk-stories/route.ts`,
`src/lib/festival-story.ts`. The existing alreadyKey checks may stay as a
fast pre-filter but the reservation is the authority.

Skip results (no RecurPost call made):
- existing live row status sent/published → "Already Published — Duplicate
  Prevented"
- existing row sending/uncertain → "Duplicate Detected — Posting Skipped"
These appear in each path's existing results/skipped lists, so the UI shows
them with no new popups. Successful sends keep their current messages
("Post Scheduled Successfully" wording where a success line exists).

**Retry of an uncertain row** (Library): refuse with the existing
needsConfirmation 409 pattern — "RecurPost may already have this. Check its
Queue; resend only if it is not there." On confirmation, re-send UPDATING
the same row (same key), never inserting a new one.

A worker/server restart mid-send leaves a `sending` row; the 5-minute cron
turns `sending` rows older than 10 minutes into `uncertain` (never resends them).

## Safety-net scan

In the cron (hourly is enough): flag any live rows that share client,
platform, content type, media identity and exact slot (or "now" within 10
minutes) — the later created → `duplicate_of` the earliest,
`duplicate_resolution_status = 'manual_removal_required'`. Never touches rows
already flagged, never deletes anything.

## Library UI (social-publisher page, Library tab)

- Flagged duplicate: amber chip "Duplicate — remove in RecurPost" + its
  RecurPost post id + a "Mark removed" button (→ resolved) and "Not a
  duplicate" (→ ignored). Original rows unchanged.
- `uncertain` row: amber "Check RecurPost queue before resending".
- `sending` row: "Sending…".
No other design change.

## Rules

No auto-deletion anywhere. Reposts on different slots and the same creative
on other accounts always publish. No new deps, no migrations. Comment
voices, indigo utilities.

## Acceptance

- Double-click Send in Automation / Compose: one RecurPost call, the second
  request reports "Duplicate Detected — Posting Skipped".
- Two sessions sending the same creative + account + slot: one wins.
- Same creative to two accounts: both send. Same creative tomorrow: sends.
- RecurPost timeout: row `uncertain`, no automatic resend; Library retry asks first.
- Restart mid-send: row becomes uncertain within 15 minutes, never resent.
- The 41 flagged historical duplicates show the chip in the Library.
- `npm run build` exit CODE 0.
