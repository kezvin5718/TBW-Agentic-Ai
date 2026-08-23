# Honest progress for the 5b Build — spec

## The problem

Clicking Build starts a request that can run four minutes and answers once, at
the end. The button says "Building…" and spins. The founder cannot tell a
working batch from a hung one — the only place the truth exists is the server
log, which says exactly where it is ("post 2 frame 1/5: rendering…") and is
never seen.

## The shape of the fix

The build writes its own progress to the database as it goes; the page polls a
tiny endpoint and shows it. Not an animated guess — a real count of frames
finished against frames to do, plus what the current frame is doing. A guessed
bar that keeps moving while the run is dead would be worse than the spinner.

## Data — DONE

`monthly_plans.build_progress jsonb` (migration applied on production). Shape:

```json
{
  "startedAt": "2026-08-23T12:00:00.000Z",
  "updatedAt": "2026-08-23T12:01:10.000Z",
  "totalFrames": 12,
  "doneFrames": 5,
  "step": "Post 3 of 8 · frame 2 of 3 · generating the background",
  "finished": false,
  "note": ""
}
```

## Work

### 1. src/lib/post-studio.ts — `generatePlanPosts` reports as it works

- After `chosen` is computed, `totalFrames` = sum of `spec.frames` over
  `chosen` (product posts skipped for want of a photo still count until
  skipped — simplest honest denominator is the sum over chosen; the skip note
  already explains any shortfall).
- Write the opening progress row immediately: `startedAt`, `totalFrames`,
  `doneFrames: 0`, `step: "Designing the posts…"`, `finished: false`.
  (Write it BEFORE `analysePlan`, which is itself slow on a cache miss.)
- Update `step` at each stage of each frame, mirroring the existing
  `console.log` calls: `"Post N of M · frame F of K · rendering"`, then
  `"… · checking and filing"`. Increment `doneFrames` after each frame is
  stored or failed.
- On every exit path (finished, paused, Drive-refused early return), write
  `finished: true` with a closing `note` (e.g. "Paused — click Build again to
  continue").
- Progress writing must never break the build: wrap each write so a failed
  update is swallowed, exactly like `logUsage` does.
- Keep the console logs as they are.

### 2. New route: src/app/api/production/plan-posts/progress/route.ts

- `GET ?planId=` — staff guard, reads `monthly_plans.build_progress`, returns
  it as `{ success: true, progress }` (or `progress: null`). Nothing else —
  this is polled every 2 seconds and must stay cheap.
- `export const dynamic = "force-dynamic"`.

### 3. src/app/dashboard/production/plan-posts/page.tsx

- While `working === "generate"`, poll the progress route every 2s (clear the
  interval when the build returns or the component unmounts).
- Replace the bare "Building…" with, under the button: a progress bar
  (`doneFrames / totalFrames`), the percentage, the `step` line, and elapsed
  time in seconds counted from `startedAt`.
- Two honesty rules, both required:
  - The bar shows real counts only; it never animates on its own.
  - If `updatedAt` is more than 90 seconds old, show an amber line: "No
    movement for Ns — the image model may be slow, or this run may have
    stopped. The page will say when it finishes." (A slow image model is a
    two-attempt, six-minute wait at the configured timeout, so silence is
    not proof of death.)
- Match the page's existing dark styling; the bar can reuse the upload
  progress bar's idiom already in this file.

### 4. Verification

`npx tsc --noEmit` clean. Visual check is the founder's, on the next build.
