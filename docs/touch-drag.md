# Team Tasks — drag-and-drop on touchscreens

Founder (19 Sept): moving a task between people must work on phones too.
HTML5 drag events do not exist for touch, so this is a hand-built long-press
drag using pointer events, living alongside the mouse path (which stays
exactly as it is).

File: `src/app/dashboard/task-manager/TaskBoard.tsx` only.

## The gesture

- **Only for `canMove` users, only `pointerType === "touch"`** — mouse
  pointers keep the existing native HTML5 DnD untouched.
- **Long-press to lift**: pointerdown on a team-column card starts a ~350ms
  timer. Finger movement > 10px before it fires cancels the lift — that's a
  scroll or the column swipe, and the native pan must win. A tap shorter than
  the timer stays a tap (expand still works).
- **On lift**: `navigator.vibrate?.(30)`; the card enters the existing
  `dragTask` state (same dim, same column highlight machinery); page
  scrolling is suppressed for the drag's duration (a document-level
  non-passive `touchmove` listener calling `preventDefault`, added on lift,
  removed on release — plus `user-select: none` on body while dragging).
- **While dragging**: a ghost follows the finger — a small fixed-position,
  `pointer-events-none`, `z-50` chip showing the task title (truncated) on
  the card's border/background style. The column under the finger is found
  with `document.elementFromPoint` (the ghost can't intercept it) — give each
  column div a `data-col` attribute with `col.name` and walk up with
  `closest('[data-col]')`. Set `dragOverCol` so the existing ring-2 highlight
  lights the target.
- **Edge auto-scroll**: the columns container (`overflow-x-auto` below md)
  gets a ref; while a touch drag is live and the finger is within ~48px of
  the viewport's left/right edge, scroll the container a few px per frame
  (rAF loop or in the pointermove handler) so off-screen designers are
  reachable. Stop scrolling when the finger leaves the edge zones.
- **On release** (pointerup): if a column is under the finger, call the
  existing `dropOnColumn(name, taskId)` — it already no-ops on the same
  person and PATCHes only the assignee. Then full cleanup. `pointercancel`
  cleans up identically without dropping.

## Wiring notes

- Use `setPointerCapture` on the card at lift so pointermove keeps arriving
  while the finger leaves the element; fall back to document-level
  pointermove/pointerup listeners if capture is unavailable.
- All listeners added at lift are removed on release/cancel — nothing leaks
  between drags; component unmount during a drag must also clean up (effect
  cleanup or a ref-held disposer).
- The ghost renders from the component (state: `{x, y, title} | null`), not
  by cloning DOM nodes.
- Do not touch: the mouse DnD handlers, the columns' existing onDragOver/
  onDrop, `dropOnColumn`'s logic, expand-on-tap, the away-until input, the
  reschedule button, or the pending/completed views.
- The long-press must not fire from interactive children — pointerdown on a
  `button`, `select`, `input`, or `a` inside the card does not start the
  timer (check `(e.target as HTMLElement).closest("button,select,input,a")`).

## Rules

Keep indigo utilities (they render TBW yellow); keep the file's comment
voice; no new dependencies; no API changes.

## Acceptance

- Phone (or the browser's mobile emulation): press-and-hold a card ~½s → it
  dims and a ghost chip appears; dragging near the screen edge scrolls the
  columns; the hovered column rings; release reassigns — only the name
  changes. A quick tap still expands the card. A vertical/horizontal swipe
  started immediately still scrolls and never lifts a card.
- Desktop mouse drag behaves exactly as before.
- An employee without the grant gets none of it.
- `npm run build` exit 0.
