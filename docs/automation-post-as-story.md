# Automation — send to the feed, to the Story, or both

Founder (29 Sept): Automation can only schedule a creative the way it was
uploaded (post/reel → feed). Wanted: a per-row choice to schedule it as a
**Story** too — or instead — and a Story NEVER carries a caption.

## Files

- `src/app/dashboard/social-publisher/page.tsx` (automation rows)
- `src/app/api/social-publisher/automation/route.ts` (POST)

## UI — automation rows

- On every automation row whose `content_type` is `post` or `reel`, a small
  **"Send as"** toggle: `Feed` (default) | `Story` | `Feed + Story`. Rows
  that ARE stories (`content_type === "story"`) show nothing new — they
  already go out as stories.
- State keyed by row id next to the schedule slots, reset exactly where they
  reset (client change, mode switch, reload after send); include it in the
  reset-count button and per-row reset link if that is cheap.
- When `Story` is chosen: the caption textarea for that row greys out with a
  one-line note "Stories carry no caption — the creative is the whole
  message." When `Feed + Story`: the caption stays editable and a muted note
  says the caption goes to the feed only.
- The "Will schedule N post(s)" arithmetic counts the story pass: a
  Feed + Story row on 2 platforms counts twice per eligible platform pair.
  Keep it honest but simple — reuse how story repeats already adjusted the
  count.

## API — POST

- Each `items[]` entry may carry `sendAs?: "feed" | "story" | "both"`
  (absent = "feed", byte-for-byte today's behaviour). Only honoured when the
  upload's `content_type` is `post` or `reel`; a story upload ignores it.
- Expansion (same pre-loop unrolling used for story repeats): an item with
  `sendAs: "story"` becomes one occurrence flagged story; `"both"` becomes
  two occurrences — one feed (as today), one story — same scheduledFor. If
  the item also carries a story repeat… it cannot: repeats are only offered
  on story-type rows, and sendAs only on post/reel rows. They never combine;
  ignore `repeat` on rows with `sendAs` defensively.
- A story-flagged occurrence, inside the existing send loop:
  - `contentType` behaves as `"story"` for the RecurPost params (whatever
    the existing story mapping is — reuse it, don't invent one)
  - **caption is null, unconditionally** — whatever the item carried
  - platforms: only `instagram` and `facebook` receive it; other selected
    platforms record a skipped result ("stories are Instagram/Facebook
    only"), the same shape as the existing video-only YouTube skip
  - the `social_posts` row records `content_type: "story"`, `caption: null`
  - a Story of a video still stages the video (Drive pre-flight etc.) —
    the staging cache already dedupes by URL, so feed+story stages once
- `doneUploads` / risk stamping / `[risk-override]` notes unchanged — a
  feed+story pair marks the upload scheduled when ANY of its sends lands
  (existing anyOk semantics).
- Response: nothing new required beyond counts staying correct.

## Rules

No schema changes, no new deps. Keep indigo utilities (TBW yellow), both
files' comment voices, `min-h-[40px] lg:min-h-0` targets, mobile wrap. The
composer, bulk-stories screen, and festival flow are untouched.

## Acceptance

- A post row set to Story on IG+FB+YouTube: two social_posts (IG, FB) with
  content_type story and NULL caption; YouTube row recorded as skipped.
- Feed + Story on IG: two social_posts — one post WITH caption, one story
  with NULL caption — same date/time.
- Default (untouched rows): payload and behaviour identical to today.
- A story-type row shows no Send-as control and behaves exactly as before.
- `npm run build` exit 0.
