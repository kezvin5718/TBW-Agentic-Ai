# Content Hub — two sections, and a festival batch that names its own brands

Founder (30 Sept, confirmed): Content Hub splits into two clear sections —
**Regular posting** (today's uploader, unchanged) and **Festivals**. The
festival flow: pick a festival (its posting date + time shown), drop up to
10 mixed-brand creatives at once with NO client chosen, QC detects the brand
on each and shows the client name, every card has an editable client
dropdown, and one Submit schedules each creative as that festival's Story at
the festival's own time. Submit is blocked until every creative has a
client. Stories carry no caption (existing behaviour).

Already done (do not migrate): `creative_uploads.client_id` is now NULLABLE.

## What already exists — reuse, don't rebuild

- QC vision (`src/app/api/content-hub/qc/route.ts`) already returns
  `detected_brand`, a festival verdict (`detected_festival`,
  `festival_verdict`) and writes `qc_detected_brand` / `qc_note`.
- `scheduleFestivalStory(uploadId)` (`src/lib/festival-story.ts`) schedules
  one QC-passed festival upload at its festival's time. Untouched.
- The single-client festival uploader on the Content Hub page and
  `/api/content-hub/festival-story` — keep working exactly as they do (they
  become part of the Festivals section, see UI below).

## New API — `/api/content-hub/festival-batch/route.ts`

**POST (multipart)** — `files[]` (cap 10 per request) + `festivalId`.
Founder/employee only. For each file: store via `storeContentHubUpload`
(same Drive path as content-hub POST), insert a `creative_uploads` row:
`client_id: null`, `content_type: "story"`, `festival_id`, a shared fresh
`batch_id`, `caption: ""`, `status: "uploaded"`, `qc_status: "pending"`.
Returns the rows.

**Detection**: extend the QC route so a pending row with `festival_id` and
NULL `client_id` runs in DETECT mode — same vision call, but instead of
"is this <known client>?" the prompt lists the client roster (names from
`clients`) and asks WHICH of them the creative belongs to (or "unknown"),
plus the existing festival-occasion judgment. Write `qc_detected_brand`,
`qc_note`, `detected` festival fields as today, and `qc_status`: `"unsure"`
always in detect mode (a detection is a suggestion, not a verification — the
human's confirmation at submit is what verifies). EXCEPTION: a festival
`mismatch` (creative is clearly for a different occasion) rejects the row
exactly as the existing festival QC does — wrong-festival creatives must not
be schedulable. Rows WITH a client keep today's QC byte-for-byte.

**PATCH (submit)** — body `{ rows: [{ id, clientId }] }`. Founder/employee.
For each row (must be `festival_id` set, status `uploaded`):
- refuse any row without a `clientId` (400 listing the file names — the UI
  blocks this anyway)
- set `client_id`; set `qc_status: "match"`; when the chosen client's name
  differs from `qc_detected_brand`, append to `qc_note`:
  "client picked by hand (QC saw: <detected>)" — the record stays honest
- call `scheduleFestivalStory(row.id)` and collect its result
- respond with per-row outcomes ({ id, scheduled, notes }) so the UI can
  show which ones queued and which blocked.

## UI — `src/app/dashboard/content-hub/page.tsx`

- **Two tabs at the top**: `Regular posting` | `Festivals` — same pill style
  as Task Manager's tabs. Regular = today's uploader + library, untouched.
  Festivals = the existing single-client festival uploader PLUS the new
  batch flow. Tab choice in component state (default Regular).
- **Festival batch panel** (inside Festivals tab):
  - festival select (from `/api/festivals`, same list the existing section
    uses) showing name + `fmtIST` date/time of posting; upcoming first
  - a multi-file dropzone/picker (images and videos, up to 10) — uploads via
    the new POST with per-file progress, then triggers QC (however the page
    triggers QC today — reuse it) and polls/refreshes until detections land
  - **the batch grid**: one card per creative — thumbnail, file name, and:
    - detected client as a chip ("QC sees: Suvarna Nagari") when detection
      matched a roster name; "QC could not tell" otherwise
    - a client `<select>` (full client list) PRESELECTED to the detected
      client when it maps to one, else empty "Pick a client…"
    - festival-mismatch rejections shown rose with the QC note, excluded
      from submit
  - **Submit button**: "Schedule N stories at <festival date, time>" —
    disabled while any non-rejected card has no client; sends PATCH; shows
    per-row results (queued / blocked and why); refreshes the library
- Detected-name → client mapping: case-insensitive trim match on client
  names (the QC route already normalises roster names when it writes
  `qc_detected_brand` for rows with clients — in detect mode make it write
  the ROSTER name when it recognises one, so the UI mapping is exact, and
  the raw seen-name only when unknown).

## Rules

- No new dependencies. Keep indigo utilities (TBW yellow), each file's
  comment voice, `min-h-[40px] lg:min-h-0` targets, mobile wrap (the grid
  stacks on phones).
- Null-client rows must not break the library list (`clients` join renders
  null → show "— pick a client" instead of a crash) or automation (it
  filters by client and by content anyway).
- Captions: never asked for, never written (festival stories carry none).

## Acceptance

- Drop 10 mixed-brand creatives on "Diwali · 20 Oct, 19:00": cards appear,
  ~most show the right client name preselected, unknowns say "Pick a
  client…", a wrong-festival creative shows rejected.
- Submit stays disabled until every non-rejected card has a client; after
  submit each creative is a scheduled Story at 20 Oct 19:00 for its client
  (visible in Social Publisher library), and hand-corrected ones carry the
  "client picked by hand (QC saw: …)" note.
- Regular tab behaves byte-for-byte as today. `npm run build` exit 0.
