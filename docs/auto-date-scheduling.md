> REMOVED 20 Oct 2026 on the founder's order — dates are set by hand again. Kept for history.

# Smart auto-dates — Automation continues the calendar by itself

Founder (18 Oct, confirmed): when a client is selected in Automation, the
date sequence must START ITSELF from the day after that client's last
occupied posting day — never from today by reflex, never colliding with
what is already booked. Stories do not occupy days; feed posts and reels
do. Manual edits always win; nothing sends without the usual review.

## Server — `src/app/api/social-publisher/automation/route.ts`

**GET** gains, alongside the existing payload (computed for the selected
client, both Clear and Risk):
- `lastOccupied`: the latest IST day (`YYYY-MM-DD`) holding any of the
  client's posts — `social_posts` with status `sent` or `published`,
  `content_type != 'story'`, day = IST day of `coalesce(scheduled_for,
  created_at)`. Null when the client has none.
- `occupiedDays`: the client's occupied IST days from today forward (same
  definition), as a sorted string array — the UI skips these. Cap the scan
  at the existing social_posts query cost (one indexed query, limit
  sensibly).

**POST** revalidation: for each non-story occurrence (converted stories and
story uploads exempt), compute its IST day; if that day is occupied by an
EXISTING sent/published non-story post of this client (re-queried at send
time — the simultaneous-upload race), refuse the whole send with 400
naming the dates: "16 Oct and 18 Oct already hold scheduled posts for this
client — adjust the dates (or delete the old posts in the Library) and
send again. Nothing was sent." In-batch same-day pairs are NOT this
guard's business (the UI's existing collision warnings own that), and
story repeats/sends stay exempt.

## UI — `src/app/dashboard/social-publisher/page.tsx` (Automation)

1. **Auto start**: when the automation rows load for a client (client
   change, mode switch, reload), set the sequence start date to the day
   after `lastOccupied` — clamped to tomorrow at the earliest when
   `lastOccupied` is in the past, and plain tomorrow when null. A start
   date the user then picks by hand is respected (do not fight the human:
   auto-set happens on load, never after a manual change in that load).
2. **The banner**: when the auto start came from a real `lastOccupied`,
   a muted line above the list: "Continuing after this client's last
   scheduled post (15 Oct) — this batch starts 16 Oct." When null:
   "No posts scheduled yet — starting tomorrow."
3. **Occupied-day skipping**: wherever the sequence assigns the next row's
   date (the existing cadence/slot machinery), a day in `occupiedDays` is
   stepped over — the row lands on the next free day per the cadence.
   Manual per-row dates (`autoDates`) are never rewritten; if a manual date
   sits on an occupied day, show the existing amber treatment on that row
   with "this day already has a scheduled post" (reuse the collision
   styling, do not invent new chrome).
4. **Start–end preview**: the existing "Will schedule N post(s)" line also
   says "· running <first date> → <last date>" computed from the final
   slots, so the range is visible before sending.
5. Story rows and story repeats: untouched by all of this (their dates
   remain the user's/festival's business and never consult occupiedDays).

## Rules

No new deps, no migrations. The composer, bulk-stories, festival flows:
untouched. Keep indigo utilities (TBW yellow), comment voices,
min-h-[40px] lg:min-h-0. IST day math via the existing helpers
(utcToIstWallClock / istWallClockToUtc) — never raw UTC dates.

## Acceptance

- Client's calendar booked through 15 Oct → load 9 approved posts →
  slots read 16–24 Oct in order, banner names 15/16 Oct, range line says
  16 Oct → 24 Oct.
- 18 Oct already occupied → slots read 16, 17, 19, 20… (18 skipped).
- Client with nothing scheduled → starts tomorrow with the no-posts banner.
- A manual date on an occupied day warns amber but is sendable only after
  the server-side guard is satisfied (i.e. the guard fires with the plain
  message if it is truly an existing post's day).
- Stories and repeats behave exactly as before.
- Two sessions sending the same days: the second gets the 400 naming dates.
- `npm run build` exit code 0 (verify the exit code).
