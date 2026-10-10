# Visual video↔thumbnail matching — the bot pairs covers by looking

Founder (10 Oct, confirmed): when a batch upload to Content Hub contains
videos AND post-size images together, the system pairs each image to its
video BY SIGHT — no filename conventions (explicitly rejected). The image
becomes that video's cover byte-for-byte; images are covers, not standalone
post uploads. Never guess: an uncertain video is flagged for a human. Works
for 1+1, partial batches, and the full 9+9 grid.

## Flow (Content Hub, Regular tab uploader)

1. The user picks a mixed set of files for one client (videos + images) in
   the existing uploader.
2. The page uploads the VIDEOS first through the existing per-file path
   (`POST /api/content-hub`, no thumbnail attached), collecting the new row
   ids. Content type: whatever the user chose (reel/post) — unchanged.
3. The IMAGES in the same picked set do NOT become hub rows. They go to a
   new lightweight endpoint that stores each to Drive and returns
   `{ url, name }` — the "cover pool".
4. The page then calls the new matcher with
   `{ clientId, videoIds: [...], images: [{url, name}, ...] }`.
5. Matched videos get `thumbnail_url` / `thumbnail_name` written on their
   rows (the existing columns — everything downstream already reads them).
6. The page shows the result on each card: the paired cover, or a
   "Pick thumbnail" flag with a dropdown of the still-unassigned pool
   images; picking one assigns it (same matcher route, explicit mode).
   Any pairing can be changed or removed the same way.

If the picked set is all-videos or all-images, nothing changes — today's
behaviour exactly.

## New API — `src/app/api/content-hub/match-thumbnails/route.ts`

Founder/employee only. Two actions in one route (or two routes if cleaner —
keep the surface small):

**POST `{ pool: true }` (multipart, images only)** — store each image via
the existing Drive path (`storeContentHubUpload` or `uploadImageToDrive`,
whichever fits — same folder family as content hub uploads), return
`[{ url, name }]`. No creative_uploads rows. Reject non-images.

**POST `{ clientId, videoIds, images }`** — the matcher:
- For each video row (must belong to clientId, be a video, and have no
  thumbnail yet unless `reassign: true`): fetch the media, extract ONE
  mid-video frame (reuse `extractVideoFrame` / the qc route's
  fetch+frame+resize pattern — do not re-invent it).
- One vision call per video: the frame plus ALL still-unassigned candidate
  images (numbered), asking "which of these images is the cover of this
  exact creative — same product, same text, same layout? Answer the number
  or 'none', with high/low confidence." Use `MODEL_FAST` via the existing
  `completeVision`, purpose `"thumb-match"`.
- Greedy uniqueness: an image pairs with at most ONE video. If two videos
  claim the same image, the high-confidence one keeps it; the other
  returns unmatched. Low confidence or 'none' = unmatched — NEVER assign.
- Write `thumbnail_url` + `thumbnail_name` on matched rows. Images are
  attached as-is — the URL of the stored original; no crop, resize, or
  re-encode anywhere.
- **Explicit mode**: `{ assign: { videoId, image: {url,name} | null } }`
  sets or clears one row's thumbnail with no AI — the manual override.
- Response: `{ pairs: [{ videoId, image|null, confidence }], leftoverImages }`.

## Engine registry

Add `"thumb-match"` to the QC area's `purposes` in
`src/lib/engine-registry.ts` (it is the same kind of looking), so Credit
Logs keeps the map complete.

## UI — `src/app/dashboard/content-hub/page.tsx` (Regular uploader cards)

- Mixed selection detected → after upload, each video card shows its paired
  cover thumbnail (small preview + name) or an amber "Pick thumbnail" chip
  with the dropdown of leftover pool images + "none". A paired card gets a
  subtle "matched by sight" note and a change control.
- While matching runs: "Matching covers…" with a spinner on the affected
  cards. A matcher failure degrades gracefully: videos stay uploaded, all
  images stay in the pool, every card gets the manual dropdown.
- Grid sequence: cards keep the upload order they already have; nothing
  reorders.

## Rules

- NEVER generate a frame-grab thumbnail for a video when the batch carried
  post-size images — unmatched means flagged, not improvised.
- No new dependencies. Keep indigo utilities (TBW yellow), comment voices,
  `min-h-[40px] lg:min-h-0`, mobile wrap.
- QC note: thumbnails ride along exactly as the existing single-upload
  thumbnail does; QC behaviour is untouched.

## Acceptance

- 3 videos + 3 lookalike-but-distinct images, meaningless filenames: all
  three pair correctly; each image used once; rows carry thumbnail_url;
  the hub cards and Social Publisher show the covers.
- 2 videos + 1 image: one pairs, one flagged "Pick thumbnail", no
  improvised cover.
- Deliberately ambiguous pair (same creative twice): at most one assignment,
  the rest flagged — never swapped at random.
- All-video and all-image uploads behave byte-for-byte as today.
- `npm run build` exit 0.
