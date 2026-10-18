# Grids & Ads — the founder's Excel tracker, live inside Social Publisher

Founder (18 Oct, confirmed): his Google-Sheet tracker becomes a fifth tab in
Social Publisher — every active client a row, the END DATE columns computed
LIVE from the posting calendar (never typed, never stale), the ownership
and money columns hand-edited by named people only.

Editors: founder + employees with the new grant `profiles.can_update_grid_ads`
(ALREADY applied, pre-granted to Vishnu/pandey ji, Neha, Yashpal, Riya,
Sejal, Sulekha). Everyone else sees the tab read-only.

Schema ALREADY APPLIED — no migrations:
- `grid_ads_tracker(client_id pk → clients, scheduling_member_id /
  ads_member_id / content_member_id → team_members, funds text,
  google_funds text, ad_budget_monthly text, monthly_report
  check('done','pending'), updated_at, updated_by)`
- `profiles.can_update_grid_ads boolean default false`

## API — new `src/app/api/grid-ads/route.ts`

**GET** (founder/employee): one payload for the board.
- All active clients (archived_at null), each with its tracker row (or
  nulls), the team list for the owner dropdowns, and `canEdit` (founder OR
  the grant).
- **Computed per client from social_posts** (status sent/published, IST day
  of coalesce(scheduled_for, created_at) — same day math as the automation
  route; reuse its helpers or copy the tiny istDay pattern):
  - `endDate`: latest day across non-story posts (the feed calendar's end)
  - `pinterestUntil`: latest day where platform='pinterest'
  - `youtubeUntil`: latest day where platform='youtube'
  Null when none. One or two indexed queries for ALL clients together
  (group in code) — never a query per client.

**PATCH** (founder or grant, else 403): `{ clientId, fields }` where fields
may carry scheduling_member_id / ads_member_id / content_member_id (null
clears), funds / google_funds / ad_budget_monthly (free text, trimmed,
≤120 chars), monthly_report ('done' | 'pending' | null). Upserts the
tracker row, stamps updated_at/updated_by. Member ids must exist in
team_members when non-null.

## UI — new `src/app/dashboard/social-publisher/GridAds.tsx`, a fifth tab

- The page's view strip gains **"Grids & Ads"** after Library. The tab
  mounts the component (lazy data load on first open is fine).
- The table (wide → scrolls in its own overflow-x-auto container, never the
  page): Client · **End Date** · Pinterest · YouTube · Scheduling ·
  Ads/Boosting · Content · Funds · Google Funds · Ad Budget monthly ·
  Monthly Report.
- **End-date colour, like the sheet**: rose when the date is past or today
  (content has run out), amber when within 5 days, emerald beyond; slate
  "—" when the client has nothing scheduled. Same treatment, lighter touch,
  on the Pinterest/YouTube cells. Rows sort: run-out first, then soonest
  end date — the sheet's red rows float to the top by themselves.
- **Editing** (only when canEdit): the three owner cells are team dropdowns
  ("—" to clear); funds/google-funds/ad-budget are small inputs saved on
  blur; Monthly Report is a Done/Pending/— select with the sheet's
  green/grey feel. Each edit PATCHes just its field; a saving spinner per
  cell; errors inline. Read-only users see plain text.
- A muted header line: "End dates come from the posting calendar and update
  themselves — only the ownership and money columns are typed here."
- A Refresh button re-fetches (the computed dates move whenever the team
  schedules, so a quick refresh beats waiting for a reload).

## Rules

No new deps, no migrations (done), nothing else in the page touched beyond
adding the tab. Keep indigo utilities (TBW yellow), comment voices,
min-h-[40px] lg:min-h-0, mobile horizontal scroll inside the card.

## Acceptance

- Zota booked through 30 Sep → rose End Date 30 Sep at the top; a client
  booked to 14 Nov shows emerald; Pinterest/YouTube columns show their own
  last days (e.g. Zota's 21 Jun) or —.
- Scheduling a new grid in Automation then pressing Refresh moves that
  client's End Date forward with no typing.
- Vishnu edits an owner and funds — saved, visible to all; an un-granted
  employee sees text only and a forged PATCH gets 403; the founder edits
  freely.
- `npm run build` exit CODE 0.
