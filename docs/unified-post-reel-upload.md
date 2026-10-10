# One Posts & Reels uploader — drop anything, the system sorts it

Founder (10 Oct): the separate Post and Reel cards caused covers to be
uploaded as standalone posts (the Shri case — image on the Post card, video
on the Reel card, matcher never ran). Replace both cards with ONE
"Posts & Reels" uploader on the Content Hub Regular tab: the team drops any
mix of files, and the system scans and classifies.

## The sorting rule

1. **Videos** → uploaded as reels (a small selector on the card lets the
   uploader say "these videos are feed posts" instead — card-level, default
   Reels).
2. **Images** → NOT rows yet. They go to the cover pool, and the existing
   visual matcher (`/api/content-hub/match-thumbnails`) runs against the
   just-uploaded videos.
3. **Matched image** → that video's thumbnail (byte-for-byte, exactly as
   built).
4. **Unmatched image** → becomes a normal POST upload: a creative_uploads
   row pointing at the already-stored file, flowing into QC and the hub
   like any post. Nothing is ever dropped silently.
5. **No videos in the drop** → every image is simply a post (byte-for-byte
   today's Post-card behaviour, minus the card). **No images** → all reels,
   as today. The matcher only runs on mixed drops.

## API — small addition only

`/api/content-hub/match-thumbnails` (or the main content-hub route,
whichever reads cleaner) gains an **adopt** mode:
`{ adopt: { clientId, images: [{url, name}] } }` → founder/employee only;
for each image already stored in OUR storage (same URL allowlist the
matcher enforces), insert a creative_uploads row: `content_type "post"`,
`status "uploaded"`, `qc_status "pending"`, file name/size best-effort —
mirroring the main POST's insert shape. No re-upload of bytes. Returns the
rows. The page calls it for the unmatched leftovers once matching settles.

Everything else — pool, matcher, assign mode, uniqueness, confidence,
flags — is already built and UNCHANGED.

## UI — Content Hub Regular tab

- The Post card and Reel card collapse into one **"Posts & Reels"** card:
  one picker/dropzone, any mix, any count (respect existing per-file
  limits). Keep the Story card and everything else exactly as is.
- After a mixed drop, the existing "Covers — paired by sight" panel shows:
  - each video: matched cover / "Pick thumbnail" flag / manual dropdown
    (all as built)
  - each unmatched image: a card saying **"No matching video — will be a
    post"** with a dropdown to override: "make it the cover of ▼ <video>"
    (calls the existing assign mode and removes it from the adopt list)
  - a single confirm beneath: "Looks right — N reels, M covers, K posts"
    → runs adopt for the K leftovers and closes the panel. (Videos and
    covers are already saved by this point; the confirm only decides the
    leftovers' fate, so a closed tab costs posts nothing — re-opening the
    hub, leftovers that were never adopted are simply gone from view but
    still in Drive; acceptable, same as the matcher's known gap.)
- The card-level "videos are Reels / Posts" selector applies to the whole
  drop; per-video flips stay out of scope.
- While scanning: the same spinner states the matcher panel already has.
- All-image and all-video drops skip the panel entirely (nothing to
  confirm) — upload and done, exactly like today.

## Rules

No new deps, no migrations. Keep indigo utilities (TBW yellow), comment
voices, `min-h-[40px] lg:min-h-0`, mobile wrap. Festivals tab, Story card,
QC, automation untouched. Never generate a thumbnail; never assign a cover
the matcher wasn't sure of; one cover one video.

## Acceptance

- Drop 9 videos + 9 covers: 9 reels with 9 matched covers, 0 posts.
- Drop 9 videos + 9 covers + 3 standalone graphics: 9 matched reels + the
  3 graphics offered as posts; confirm creates exactly 3 post rows.
- Drop 5 images only: 5 posts, no panel, no matcher calls.
- Drop 3 videos only: 3 reels, no panel.
- Override works: flip one "will be a post" image into a chosen video's
  cover before confirming.
- `npm run build` exit 0.
