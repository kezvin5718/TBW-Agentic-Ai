# Carousels, Phase 1 — detection, grouping, one card per carousel

Founder (19 Oct, confirmed, phased): images dropped together are recognised
as carousels — grouped, ordered, reviewed, and saved as ONE Content Hub item
each. Publishing the carousel (Phase 2) waits on a live RecurPost API test;
Phase 1 ends at the hub with carousels excluded from Automation sends.

Schema ALREADY APPLIED — no migrations:
- creative_uploads.content_type now allows 'carousel'
- `carousel_slides(id, upload_id → creative_uploads cascade, slide_no,
  file_url, file_name, created_at, unique(upload_id, slide_no))`

## Detection — new `src/app/api/content-hub/carousel-detect/route.ts`

POST `{ clientId, images: [{url, name}] }` (founder/employee; own-storage
URL allowlist exactly like match-thumbnails). Pipeline, cheap first:

1. **Filenames**: stems with trailing/embedded numbers group and order
   (`slide_1`, `carousel_02`, `post_03`, `diwali-3`). Same stem + clean
   consecutive-ish numbering = a high-confidence group, ordered by number.
2. **Vision for the rest**: unnumbered-by-filename images go on ONE
   labelled contact sheet (the thumb-matcher pattern — reuse its sheet
   builder approach) to MODEL_FAST via completeVision, purpose
   "carousel-detect": "group the images that are slides of one carousel
   (same design system, continuing layout); read any slide markers (1/5,
   2, 03) — a price, date, offer or product code is NOT a slide number;
   answer groups with slide order and confidence high|medium, or single."
3. **Merge** the two sources; a filename group stays authoritative.
4. **Verdicts per group**: high → `auto` (pre-approved grouping), medium →
   `suggested` (requires a human tick), anything unclear / missing or
   duplicated slide numbers → the images stay singles, the issue named
   (`missing_slides`, `duplicate_slides` fields per the founder's shape).
5. Response per the founder's expected shape: an array of groups — each
   `{ post_type: "carousel"|"single", confidence, requires_review, slides:
   [{slide_number, filename, url}], missing_slides, duplicate_slides }` —
   singles included. Never invent a slide, never reorder arbitrarily:
   explicit numbering wins over upload order; without any numbering the
   vision order is a SUGGESTION and `requires_review` is true.

## Creation — extend the same route (or sibling action)

POST `{ create: { clientId, groups: [{ slides: [{url,name}], coverIndex? }] } }`:
for each group insert ONE creative_uploads row — content_type 'carousel',
media_type 'image', file_url = cover slide's url (slide 1 unless
coverIndex), file_name "<n> slides — <first filename>", status 'uploaded',
qc_status 'pending' — then its carousel_slides rows in order. Leftover
singles are the existing adopt mode's business (the page already has it).
Same auth + URL allowlist. Rollback the row if slides fail to insert.

## UI — the unified Posts & Reels uploader (`content-hub/page.tsx`)

- An all-image drop of ≥2 images now routes: pool-upload the images (the
  existing pool endpoint), call carousel-detect, and open a **Carousels**
  review panel (sibling of the covers panel, same look):
  - each detected group: cover thumbnail, "N slides", the slides in a
    horizontal strip (their numbers shown), confidence chip ("grouped by
    filenames" / "grouped by sight — confirm"), controls: ◀▶ reorder a
    slide, ✕ remove a slide (back to singles), set-cover, and for
    suggested groups an explicit "Yes, one carousel" / "No, keep separate"
    pair; missing/duplicate numbering shows an amber note.
  - singles listed below as "will be individual posts", with "make a
    carousel from selected" (checkbox + button) for manual grouping.
  - one sticky confirm (the batch panel's pattern): "Save N carousels and
    M posts" → create call + adopt for singles → refresh → QC runs.
- A **single-image drop or a drop of 1 image** behaves exactly as today
  (no panel, no detection calls). Mixed video+image drops keep the covers
  flow — carousel detection is for all-image drops only in Phase 1.
- **Hub rendering**: a carousel row's card/table entry shows the cover with
  a "▣ N slides" badge; clicking the preview opens a tiny slides viewer
  (modal strip, read-only). Type column reads "carousel". Delete deletes
  the row (slides cascade).
- **QC**: the carousel row flows through existing QC on its cover (the
  file_url) — one verdict per carousel, nothing per-slide in Phase 1.
- **Automation**: exclude content_type 'carousel' from both Clear and Risk
  GET lists and refuse them in POST with "Carousel publishing arrives in
  Phase 2 — this carousel is safe in the hub meanwhile." The library/hub
  keeps showing them.

## Rules

Images are never modified, re-encoded, or regenerated; a group is never
formed across clients; manual override on everything; JPG/JPEG/PNG/WEBP.
No new deps, no migrations (done). Indigo utilities, comment voices,
min-h-[40px] lg:min-h-0, panels scroll inside themselves. Add
"carousel-detect" to the QC area's purposes in engine-registry (same as
thumb-match).

## Acceptance

- 15 images (5 slide_A_*, 4 named B-1..B-4, 3 visually-continuous
  unnumbered, 3 unrelated singles): panel shows A high-confidence ordered,
  B high-confidence, the unnumbered trio as suggested-needs-confirm, 3
  singles; confirm → 3 carousel cards ("5 slides", "4 slides", "3 slides")
  + 3 posts; QC runs on 6 covers; Automation does not offer the carousels.
- post_03/01/04/02 order themselves 1-4 regardless of upload order.
- An image with "25% OFF" is never read as slide 25.
- Duplicate numbering (two slide_2) → singles + amber note, nothing guessed.
- `npm run build` exit CODE 0.
