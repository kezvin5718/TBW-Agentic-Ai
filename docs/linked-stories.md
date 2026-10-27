# Linked Stories — a post and its 9:16 Story travel as one

Founder (27 Oct, confirmed): designers make each creative twice — the feed
post/reel and a 9:16 Story version. Upload once; the Story is matched to its
post by sight, shown beside it, and one schedule sends both. Linked Story goes
out in the SAME slot as its post (editable). Story IMAGES are recognised by
shape (9:16); Story VIDEOS only when uploaded through the Story card.

Schema ALREADY APPLIED on creative_uploads — no migrations:
- `linked_story_id uuid → creative_uploads(id) on delete set null` (on the
  POST/REEL/CAROUSEL row, pointing at its Story row)
- `story_link_source text check ('auto','manual')`
- unique partial index: one Story can be linked to at most ONE post.

Deleting a post frees its Story automatically (the link lives on the post row);
deleting a Story nulls the post's link (FK set null).

## 1. Classification in the unified Posts & Reels uploader (content-hub page)

Read each image's natural width/height client-side before upload. An image
within ±3% of 9:16 (ratio 0.5625) is a **Story** — uploaded as its own
creative_uploads row with content_type 'story' through the existing POST (QC
as today). 4:5 images keep their current meaning (covers for reels / posts),
everything else stays a post. The pre-upload summary line names the stories
("2 stories will be linked to their posts"). Videos are never auto-classed as
stories here.

## 2. Matcher — new `src/app/api/content-hub/match-stories/route.ts`

POST `{ clientId, postIds?: string[], storyIds?: string[] }` (founder/
employee; same auth + own-storage URL allowlist pattern as match-thumbnails):
- **Posts to place**: the given postIds plus, when storyIds are given, the
  client's waiting posts (status uploaded, content_type post/reel/carousel,
  linked_story_id null) — that is the Story-first case.
- **Candidate Stories**: the given storyIds plus the client's waiting stories
  (status uploaded, content_type story, festival_id null, not linked by any
  post) — that is the post-first case.
- One vision call per post (MODEL_FAST, completeVision, purpose
  "story-match"): the post's image (post/carousel: file_url; reel: its
  thumbnail_url, else an ffmpeg mid frame via the existing helpers) plus ONE
  labelled sheet of candidate stories (the thumb-matcher sheet builder
  pattern) — "which of these Stories is the 9:16 version of THIS creative:
  same product, same offer/price text, same design? number or none, high or
  low." A Story may differ in layout (taller crop); same brand alone is NOT a
  match.
- Only `high` assigns; a Story claimed by two posts goes to neither (both
  flagged). Writes `linked_story_id` + `story_link_source='auto'` guarded by
  `linked_story_id is null` (never re-link a post that has one).
- Explicit modes: `{ link: { postId, storyId } }` → manual link (source
  'manual', fails cleanly on the unique index), `{ unlink: { postId } }`.
- Response: `{ pairs: [{ postId, storyId|null, confidence, note }] }`.
- Add "story-match" to the QC area purposes in engine-registry.

Triggers: the uploader calls match-stories after a drop that contained posts
or stories (both sets of new ids), alongside the existing cover matcher.

## 3. Content Hub display

- A post/reel/carousel row with a linked Story shows a small 9:16 Story
  preview beside its preview, a chip "Story matched automatically" (or
  "Story linked by hand"), and a compact control: Change ▾ (that client's
  waiting stories) · Unlink.
- A post without one shows a muted "No matching Story" with the same Change ▾
  dropdown (only if waiting stories exist for the client).
- A Story row that is linked shows "linked to <post file name>" so nobody
  sends it twice by hand.

## 4. Automation (`automation/route.ts` + page)

- GET: return each row's linked story (id, file_url, media_type, qc_status,
  status). **Exclude linked Story rows from the list** — they travel with
  their post (unlinked stories still appear as today).
- Row UI: a post with a linked Story shows the Story preview beside it and an
  "Include Story" checkbox (default on). When a linked Story exists the
  Send-as control is hidden (the real Story replaces converting the post).
- POST: an item may carry `withStory: false` to skip it. Expansion adds a
  story occurrence for the linked Story upload: same scheduledFor, sent with
  the existing story params (fb/in post type story, client-name message,
  Instagram + Facebook only, honest skips elsewhere), its own social_posts
  rows content_type 'story', video staging if the Story is a video.
- Gate: in Clear mode the linked Story must itself be QC match; otherwise the
  post still goes and the result says "linked Story not QC-approved —
  skipped". In Risk mode the existing override logic applies to it too.
- doneUploads: the post and its Story are marked scheduled independently on
  their own success (a failed Story stays uploaded and linked, retryable).
- Every existing guard (caption, past time, risk stamping) unchanged.

## Rules

No AI generation or adaptation of Stories (originals untouched; the existing
Send-as-Story conversion remains the fallback when no Story exists). Never
link on a guess; one Story one post; manual links never auto-replaced. No new
deps, no migrations. Indigo utilities, comment voices, min-h-[40px]
lg:min-h-0.

## Acceptance

- Drop 3 posts + their 3 Story versions: three links, each card shows its
  Story; Automation shows 3 rows (not 6), each sending feed + Story in the
  same slot.
- Upload a Story alone, then its post next day → linked on the post's upload.
- A Story for a different product never links.
- Unlink / Change work and persist; deleting the post frees the Story.
- Linked Story failing QC: post sends, Story skipped with the reason.
- `npm run build` exit CODE 0.
