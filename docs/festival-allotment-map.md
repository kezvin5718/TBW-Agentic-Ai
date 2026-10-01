# Festival Allotment Map — who makes what, standing answer, one-click tasks

Founder (1 Oct, confirmed with recommendations): a permanent allotment
hierarchy in Task Manager's Festivals area, per his diagram:

- **Master designers** create the original festival creative for their
  **master clients** (Bhavesh → Anantam, Oro Jewels, SAJ, Suvrana …)
- **Adaptation clients** hang under a master client: their creative is
  ADAPTED from that master's design by a named adaptation designer
  (Anantam → RKS → Anisha)
- **Standalone clients** get a fresh design by a named designer (SWAD →
  Girish), never adapted

Pick a festival, press **Allot**, and every node becomes a task in the
right designer's sheet. One standing map reused for every festival.
**Deadlines staggered**: master + standalone due festival − 4 days,
adaptations due festival − 2 days (masters must exist first), both clamped
to now. Allotting twice skips clients already on that festival.

**Visibility**: ONLY founder + employees with the new grant see the map at
all. Grant: `profiles.can_manage_allotment` — "Can manage festival
allotment" checkbox in Team & Access, exact same plumbing as "Can move
tasks". Rights-holders edit everything: designers, relinks, add client
(any kind), delete, drag & drop.

Schema ALREADY APPLIED in production — no migrations:
- `festival_allotment(id, kind check in ('master','adaptation','standalone'),
  client_id unique → clients, designer_member_id → team_members,
  master_client_id → clients, sort, created_at)`
- `profiles.can_manage_allotment boolean default false`

## API — new `src/app/api/festival-allotment/route.ts`

All verbs require founder OR `can_manage_allotment` (a helper mirroring
`mayMoveTasks` in the team-tasks route). Everyone else gets 403 — even GET:
the map is confidential by the founder's order.

- **GET** → `{ nodes, clients, team, canManage: true }` — nodes with client
  + designer names joined; clients and team lists for the pickers (reuse the
  shapes the Festivals board already loads if convenient).
- **POST** `{ kind, clientId, designerMemberId?, masterClientId? }` —
  validation: client exists and is not already in the map (the unique
  constraint backs this — return its violation as a friendly 409);
  `adaptation` requires a `masterClientId` that is itself a `master` node's
  client; `master`/`standalone` must not carry one.
- **PATCH** `{ id, designerMemberId?, masterClientId?, kind? }` — same
  validation; moving an adaptation = PATCH with the new `masterClientId`
  (this is what a drag sends). Changing a master to another kind while
  adaptations hang off it → 409 "move or delete its adaptations first".
- **DELETE** `{ id }` — deleting a master with adaptations → same 409.
- **POST with `{ allot: true, festivalId }`** (or a separate action field —
  pick one shape and keep it): loads the festival (404 if gone), loads the
  map + `festival_tasks` for dedupe, and for each node whose client is NOT
  already on the festival creates, exactly in the festival-tasks route's
  existing pattern (task first, then festival_tasks row, back-links in
  metadata, rollback on row failure):
  - task titles/descriptions:
    - master: title `<festival> — <client> — master creative`,
      description `Create the original <festival> creative for <client>.
      Adaptations for <n> client(s) will be made from it.` (n may be 0)
    - adaptation: title `<festival> — <client> — adapt from <master client>`,
      description `Adapt <master client>'s <festival> master creative for
      <client>.`
    - standalone: title `<festival> — <client> — fresh design`,
      description `Fresh <festival> design for <client> — not adapted from
      any other client.`
  - type "design", priority "medium", source "festival"
  - assignee from the node's designer: team_members name + profile_id →
    `assignee_name`/`assignee_id` (null designer = unassigned; do NOT call
    the PM auto-assign — this map IS the assignment)
  - deadlines: master/standalone `scheduled_at − 4d`, adaptation `− 2d`,
    both `Math.max(…, now)`; no festival date → +7d / +9d from now so
    adapters still trail masters
  - festival_tasks rows carry team_member_id + assignee_name as the
    existing POST does
  - respond `{ created, skipped, perDesigner: [{ name, count }] }` so the UI
    can say "14 tasks created — Bhavesh 4, Anisha 6, …; 3 already allotted".

## UI — new `src/app/dashboard/task-manager/AllotmentMap.tsx`, wired into FestivalBoard

- FestivalBoard gets a small view toggle at the top: **Board** (today's
  view, default) | **Allotment map** — the toggle itself renders ONLY when
  the API said `canManage` (fetch it lazily; a 403 simply means no toggle).
  Non-managers see zero trace of the feature.
- The map reads like the founder's diagram, column-ish but web-honest
  (stacked groups that wrap on mobile):
  - group by master designer: a designer card (avatar + name) containing
    their **master client** boxes; inside each master box its **adaptation
    rows**: client name → designer select → delete button
  - each master box header: client name + master-designer select + delete
  - a **Standalone new designs** section at the bottom: rows of client →
    designer select → delete
  - **Add** controls: one "Add client" button opening a small inline form:
    client select (only clients not in the map), kind (Master / Adaptation
    / Standalone), master-client select when Adaptation. Validation errors
    from the API show inline.
  - **Drag & drop** (desktop, HTML5, no library): drag an adaptation row
    onto a different master box → PATCH masterClientId. Keep it simple —
    adaptations are the only draggable things; the master select in each
    row is the equal-power fallback (and the mobile path). Visual: dashed
    ring on the hovered master box.
  - **Allot bar**: festival select (same list the board uses) + button
    `Allot <festival name> — creates the tasks` with a confirm dialog
    naming the count ("This creates up to N tasks. Continue?"), then the
    response summary shown plainly, with "already allotted" skips named.
- Touch targets `min-h-[40px] lg:min-h-0`; indigo utilities (TBW yellow);
  the file's comment voice; mobile = stacked groups, selects instead of
  drag.

## Team & Access

"Can manage festival allotment" checkbox beside the existing two — copy the
`can_move_tasks` row and plumbing exactly (`src/app/dashboard/team/page.tsx`
+ `/api/team/route.ts`, new `set_allotment` action or the equivalent of the
existing pattern).

## Rules

No new dependencies. `src/lib/pm-auto-assign.ts`, the existing Festivals
board behaviour, and the Task Board are untouched (the created tasks flow
through them naturally). Null-designer nodes are legal (unassigned tasks).

## Acceptance

- An employee without the grant sees no Allotment toggle and gets 403 from
  every verb. Founder + granted employees see and edit everything.
- Building the founder's diagram is possible exactly: 4 master designers,
  9 master clients, 17 adaptations, 3 standalones.
- Allot "Gandhi Jayanti · 2 Oct 19:00": masters/standalones due 28 Sept
  (clamped to now if past), adaptations due 30 Sept; every task in the
  right designer's My Tasks with the adapt-from wording; Festivals board
  shows one row per client; re-allotting reports all-skipped.
- Drag RKS from Anantam onto SAJ → its row moves and survives reload.
- `npm run build` exit 0.
