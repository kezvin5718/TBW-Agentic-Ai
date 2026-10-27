# Automatic video thumbnails — every video gets a real frame, no credits spent

Founder (27 Oct, decisions confirmed): every video gets an automatically
selected thumbnail. A designer/matched cover always wins; an auto frame only
fills an empty slot. The auto frame IS sent as the published cover when no
designer cover exists (automation already sends `thumbnail_url` as
in_thumb/fb_thumb — filling the column is the whole publishing change).
Backfill all existing videos. Frame choice is image maths (sharp), never AI.

Schema ALREADY APPLIED on creative_uploads — no migrations:
`thumbnail_status` (pending|processing|completed|failed), `thumbnail_source`
(designer|matched|auto), `thumbnail_attempts int default 0`,
`thumbnail_generated_at`, `video_duration numeric`, `video_aspect_ratio text`.
State today: 23 videos completed/designer, 433 pending (= the backfill).

## The engine — new `src/lib/video-thumbnail.ts`

`generateThumbnailFor(uploadId)`:
1. **Claim atomically** (idempotency): `update … set thumbnail_status =
   'processing', thumbnail_attempts = thumbnail_attempts + 1 where id = $1
   and media_type = 'video' and thumbnail_url is null and thumbnail_status in
   ('pending','failed') and thumbnail_attempts < 3 returning …`. No row back =
   someone else has it or it's done → return quietly.
2. **Fetch to a temp FILE, streamed** (never the whole video in memory): Drive
   files via the existing Drive download path (reuse what the QC route's
   fetchMediaBuffer does for Drive, but stream to disk), else plain fetch.
   Cap 1.5GB; beyond that → failed with a clear note.
3. **ffprobe** duration + width/height (+ rotation) → save `video_duration`,
   `video_aspect_ratio` ("9:16", "4:5", "1:1", "16:9" by nearest, else W:H).
4. **Candidates**: ffmpeg seeks to 8 timestamps at 8%,20%,32%,44%,56%,68%,
   80%,92% of duration (short clips: clamp inside 0.2s..duration-0.2s);
   output JPEG at native aspect, long side ≤1080, never stretched.
5. **Score with sharp** per candidate: greyscale stats → mean brightness and
   stdev (contrast); sharpness = stdev of a Laplacian convolution
   (`convolve` kernel [0,1,0,1,-4,1,0,1,0]). Reject mean <28 or >232, contrast
   stdev <14 (black/white/flat/fade). Score = sharpness × min(contrast/40,1).
   Highest score wins; if every candidate is rejected, use the 44% frame
   (fallback — still a real frame from this video, never a blank).
6. **Store** via `storeContentHubUpload` (Drive, Supabase fallback) under the
   client's month folder, name `<original-stem>-thumb.jpg`.
7. **Commit, guarded**: `update … set thumbnail_url, thumbnail_name,
   thumbnail_source='auto', thumbnail_status='completed',
   thumbnail_generated_at=now() where id=$1 and thumbnail_url is null` — so a
   designer cover that landed while this ran is never overwritten (if it
   lost the race, delete nothing, just mark status completed).
8. **Failure**: status `failed` (retried later while attempts < 3); the
   original video is never touched; temp files removed in `finally`.

`processPendingThumbnails(limit)`: oldest rows with status pending, or failed
and attempts < 3, processed ONE AT A TIME (memory), returns counts.

## Triggers

- **Right after upload**: every path that inserts a video creative_uploads row
  (main content-hub POST, festival-batch, any others you find) sets
  `thumbnail_status: 'pending'` on insert and fires
  `void generateThumbnailFor(id)` (not awaited — the Node server keeps
  running it after the response).
- **Cron**: register in `src/lib/cron-scheduler.ts` every 5 min →
  `processPendingThumbnails(4)` (drains retries + backfill ≈ 48/hour).
- **Kick endpoint** `POST /api/thumbnails/process` (founder/employee):
  runs `processPendingThumbnails(2)` — the hub page calls it (debounced, at
  most once a minute) while it shows any pending video, so the queue drains
  even if CRON_ENABLED is off on the server.
- **From URL** `POST /api/thumbnails/from-url { url }` (founder/employee, own-
  storage URL allowlist as in match-thumbnails): same steps 2–6 on a bare
  URL, returns `{ url, name }` — for Compose's direct uploads.

## Designer always wins

- The cover matcher (`match-thumbnails`): treat `thumbnail_source = 'auto'`
  as "no cover yet" — it may replace an auto frame; on assign set
  `thumbnail_source='matched'`, status completed. Manual assign → `designer`.
- The main upload POST's paired-thumbnail path → `designer`.
- Nothing auto ever overwrites a non-null thumbnail.

## UI — show the frame wherever the video shows

- **Content Hub** cards/table preview, **Automation** rows, **Multi-Story**
  slots (small preview beside the slot's dropdown when the chosen upload has
  one), **Library** cards: render `thumbnail_url` when present (object-cover
  in the existing preview box, aspect untouched). While
  pending/processing: the existing placeholder plus a tiny spinner + "making
  thumbnail…"; failed after retries: the placeholder + "no thumbnail".
- **No-refresh appearance**: when a list on screen holds pending/processing
  videos, re-fetch it every 15s (stop when none remain or after 5 min).
- **Compose**: after a video is attached with no thumbnail chosen, call
  from-url and set the result as the thumbnail (visibly labelled "auto
  thumbnail — change it" so the existing manual picker/upload still wins).
- Grids & Ads: no change (no video previews there).

## Rules

No AI calls, no new deps (ffmpeg/ffprobe already in the container, sharp
already used). No redesign — reuse existing preview boxes. Indigo utilities,
comment voices. Never assign a thumbnail to the wrong row (everything keyed
by the claimed id), never a blank image, original videos untouched.

## Acceptance

- Upload 3 videos together → each gets its own non-black frame within a
  minute, appearing in the hub without refresh; statuses completed/auto.
- A video whose first seconds are a black logo sting gets a mid-video frame.
- A mixed drop: the matcher's cover replaces any auto frame; auto never
  replaces the matcher's.
- Automation sends the auto frame as in_thumb/fb_thumb (existing path).
- A 426MB video completes (streamed, not buffered).
- The 433 backfill drains over hours without slowing the app; a broken file
  ends `failed` after 3 attempts with the placeholder shown.
- `npm run build` exit CODE 0.
