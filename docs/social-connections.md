# Social Connections — the health board for every client×platform mapping

Founder (17 Oct, confirmed): a section under Social Publisher where staff see
the TRUE state of every RecurPost mapping — connected, failing, dead, or
unmapped — with a Refresh that checks reality rather than trusting
RecurPost's green badge (proven wrong twice: SK's YouTube showed connected
while every send 401'd).

## API — new `src/app/api/social-connections/route.ts`

**GET** (founder/employee): builds the board.
- Load `recurpost_account_map` (agency_settings) + the live account list
  (`listSocialAccounts()` from lib/recurpost).
- **Stale detection**: a mapped account id absent from the live list = a dead
  mapping (the shadowing trap — SK twice). Mark it `dead`.
- **Probe**: for each mapped id present in the live list, call
  `getHistory(accountId)` as a harmless liveness check — inspect what the
  endpoint returns for a healthy vs a broken account (expect `status: 401`
  or an error field when the token is dead). Probe with a small concurrency
  cap (3–4) and a per-call timeout; an inconclusive probe is `unknown`, not
  `failing`. Only run probes when `?probe=1` (the Refresh button) — the
  plain GET renders instantly from mappings + send history alone.
- **Send record**: from social_posts, last 30 days, per client+platform:
  last `sent` at, last `failed` at, and the latest failure's human snippet
  (strip the `[recurpost]`/`[automation]` prefix, trim to ~80 chars).
- **Cell state** (one per active client × platform in
  instagram/facebook/pinterest/youtube):
  - `unmapped` — no mapping
  - `dead` — mapped id missing from live list
  - `failing` — probe said dead, OR the send record's latest event is a
    failure (failure newer than last success)
  - `connected` — mapped, live, probe ok (or not probed) and latest send
    event is success or none
- Response: `{ cells: [...], refreshedAt, probed: boolean }` with
  clientName, platform, state, lastSuccess, lastFailure, reason,
  accountId (needed for the founder's remove action).
- **DELETE** (founder only): `{ accountId }` — removes that key from the
  saved map (the one-click "Remove dead mapping"). Refuse if the id IS in
  the live list and currently healthy — removing a live mapping is the
  mapping panel's job, not this board's.

## UI — new `src/app/dashboard/social-publisher/SocialConnections.tsx`, mounted at the bottom of the Social Publisher page

- A collapsible card "Social Connections" (collapsed by default,
  localStorage-remembered like the task board strip).
- Header: **Refresh** button (calls GET with `?probe=1`, shows spinner,
  then "checked live at <time IST>") and a plain-GET load on first open.
- The grid: rows = clients that have at least one mapping OR one send in 30
  days (the full dormant-client list would drown the signal); columns =
  the four platforms. Cell renders:
  - ✓ emerald "Connected" (+ last success date, muted)
  - ⚠ amber/rose "Failing" + the reason line + "since <date>"
  - 👻 rose "Dead mapping" + founder-only "Remove" button (confirm first)
  - — slate "Not mapped"
  - tooltips carry the full reason text.
- A one-line legend under the grid, and a short plain-language note:
  "Reconnecting happens in RecurPost (Social Profiles) — after reconnecting,
  Refresh accounts in the mapping panel above and re-map, then Refresh here."
- Wide table scrolls inside its own container (`overflow-x-auto`) — never
  the page; `min-h-[40px] lg:min-h-0` on buttons; indigo utilities.

## Rules

No new deps, no migrations. The mapping panel, send paths, and everything
else untouched. Staff see everything; only the founder gets the Remove
button (server enforces).

## Acceptance

- With today's data: Swarna Kanchi's YouTube cell reads Failing with the
  401 reason and the 1 Oct onset; any stale map id shows Dead with Remove;
  healthy clients show Connected with their last-success dates; unmapped
  dormant clients don't bloat the grid.
- Refresh with probe marks a dead-token account Failing even when its last
  send was long ago.
- An employee sees the board but no Remove buttons; a forged DELETE is 403.
- `npm run build` exit 0 (verify the EXIT CODE, not the compile line).
