# Carousels, Phase 2 — published through RecurPost as one post

Founder (20 Oct, option B): carousels publish via the RecurPost API. The
ground truth that makes this safe: our sender ALREADY passes
`image_url: [url]` as an array — multi-image is the native shape of the
parameter. A carousel send = the ordered slide URLs in that array, on a
normal feed post, Instagram + Facebook only.

Schema ALREADY APPLIED: social_posts.content_type now allows 'carousel'.

## Automation — carousels become sendable (`automation/route.ts` + page)

- **Lists**: remove the Phase-1 exclusion — a carousel row (status
  uploaded, qc match / risk rules unchanged) appears in Clear and Risk
  exactly like a post, with its cover and the "▣ N slides" badge in the
  row (the page already renders that badge in the hub — reuse the visual).
- **GET** joins the ordered slides for carousel rows (ids + urls), as the
  hub list already does.
- **Caption**: one caption per carousel — the existing per-row caption box
  and ✨ work as-is (the engine reads the cover); no per-slide captions.
- **Send**: a carousel occurrence sends ONE post per selected platform with
  `image_url` = the ordered slide URLs. Platforms: instagram and facebook
  only; pinterest/youtube record the honest skip ("carousels are
  Instagram/Facebook only — skipped"), same shape as the story skip. No
  fb_post_type/in_post_type override (a carousel IS a feed post to
  RecurPost); no video staging (slides are images); thumbnails none.
- **social_posts row**: content_type 'carousel', media_url = cover,
  caption as sent, webhook note prefixed as today; `[carousel N slides]`
  appended to the note so the Library and history say what it was.
- **Everything already built applies unchanged**: occupied-day logic
  (carousels occupy days like posts), the auto-start, the past-time and
  missing-caption guards' behaviour for posts, risk stamping, doneUploads.
- **Send-as / repeat**: not offered on carousel rows (no story conversion,
  no repeat) — hide those controls for content_type 'carousel'.

## Composer and the Phase-1 refusal

- Remove the automation POST's Phase-1 refusal message.
- The composer stays out of scope — carousels are born in the hub and sent
  from Automation.

## Library

- The Library list shows carousel posts with a "▣ carousel" type label;
  no other library changes.

## The live verification, honest and cheap

Because RecurPost's multi-image behaviour is proven only by their composer
and the array-shaped param (docs are not public), the FIRST carousel send
is the test. Response handling must therefore surface RecurPost's answer
VERBATIM on failure (the existing detail plumbing already does). Nothing
else special — if the array is refused, the row fails cleanly with the
real reason, nothing posts, and the error tells us the param to fix.

## Rules

No new deps, no migrations (done). Indigo utilities, comment voices,
min-h-[40px] lg:min-h-0. QC gating identical to posts. Carousel slides are
sent in carousel_slides.slide_no order — never resorted.

## Acceptance

- A QC-passed 5-slide carousel appears in Clear with its badge, takes a
  caption, schedules on the auto-dated day, sends to IG+FB as one post
  each with 5 ordered image_url entries, skips Pinterest/YouTube honestly,
  lands in the Library as "▣ carousel", occupies its day for the next
  batch, and is marked scheduled in the hub.
- Risk mode offers a QC-refused carousel with the same override recording
  as posts.
- Send-as and Repeat controls absent on carousel rows.
- `npm run build` exit CODE 0.
