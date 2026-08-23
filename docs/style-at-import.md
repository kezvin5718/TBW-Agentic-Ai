# Style at Import — spec

**Goal.** The founder picks a Style Library category at the moment a plan is
imported in Campaign Planning. That choice is stored on the plan and drives
every image prompt the 5b designer writes for it. Import also reports the
plan's own art direction (and warns when it clashes with the chosen style), so
a "black teaser week" is discovered at import, not in the creatives.

**Why not build prompts at import?** Prompts frozen at import go stale — the
Style Library, brand colours and founder corrections all change after import.
The 5b designer already builds every prompt from live data and caches by input
hash. Import's job is to capture *intent* (the style choice) and surface the
plan's demands; the designer keeps building prompts, now under that style.

## Data

- `monthly_plans.style_category text` — **DONE** (migration applied on
  production). One of `traditional | modern | surreal | boutique`, or NULL
  (= fall back to `clients.default_style_category`).
- `monthly_plans.color_palette jsonb` — **DONE** (migration applied). Array of
  `#RRGGBB` strings the founder fixed for this plan at import, or NULL/empty
  (= the designer uses Brand Brain colours + the house look, as before). When
  present, these colours are binding: every backgroundHex/accentHex/textHex
  the designer writes comes from or harmonises with them.

## Design resolution (src/lib/post-designer.ts) — DONE

`analysePlan(planId, styleOverride?)` resolves the design style as:

1. `styleOverride` — the caller's explicit pick (5b's dropdown)
2. `monthly_plans.style_category` — chosen at import
3. `clients.default_style_category`

The resolved style feeds `houseLookDigest(style)` into the art-director
prompt, and both the style name and the digest are part of `designed_hash` —
so changing the style **re-designs every prompt** for the plan (one paid LLM
call), and switching back is also a re-design. The returned `styleDefault` is
the resolved style, which 5b pre-selects.

## Remaining work

### 1. src/app/api/production/plan-posts/route.ts

- **GET**: read `url.searchParams.get("style")` *before* calling
  `analysePlan`, and pass it through:
  `analysePlan(planId, styleParam || undefined)`. Keep the existing
  `styleCategory` computation for the style-block preview exactly as it is
  (it must still use `styleParam !== null ? (styleParam || null) : plan.styleDefault`).
- **POST (generate)**: no change here — but in `src/lib/post-studio.ts`,
  `generatePlanPosts` must call
  `analysePlan(planId, options.styleCategory || undefined)` so the build uses
  the same style the page showed.

### 2. src/app/api/planning/save-plan/route.ts

- Accept optional `styleCategory` in the JSON body.
- Persist it on both the update and insert paths — but only when the field was
  provided (`styleCategory !== undefined`), so older callers can't wipe a
  stored choice. Empty string means "clear to NULL".

### 3. src/app/api/planning/import/route.ts

- Accept an optional `style` form field (string, may be empty).
- Add an `artDirection` object to the success response:
  ```ts
  artDirection: {
    directed: number,          // rows with a productionNote (already computed as withDirection)
    sample: string[],          // up to 5 distinct non-empty productionNotes, each trimmed to 110 chars
    darkCount: number,         // notes matching /black|dark|charcoal|noir|moody/i
    styleClash: string | null, // set when style was provided, darkCount > 0, and the
                               // style name is not itself a dark one — e.g.
                               // `3 row(s) call for dark/black frames, but the chosen style is "boutique" (warm). The plan's notes win where explicit — expect those posts to come out dark unless the notes are edited.`
  }
  ```
- No LLM call for this — pure extraction from the parsed calendar.

### 4. src/app/dashboard/planning/page.tsx

- Add `importStyle` state (`useState<string>("")`), rendered as a small
  `<select>` next to the import-file control, options:
  `"" = Client default`, `traditional`, `modern`, `surreal`, `boutique`.
  Match the page's existing dark select styling.
- `handleImportPlan`: append `fd.append("style", importStyle)`; pass
  `styleCategory: importStyle` in the auto-save body.
- The manual "Keep my slots" save (`handleKeepSlots` or equivalent near line
  560–610) also passes `styleCategory: importStyle`.
- Render the art-direction report after import: a small panel under the
  existing `importNote` showing `directed` count, the `sample` notes as a
  list, and `styleClash` as an amber warning line when present. Reuse the
  page's existing panel styling (slate-950 card, amber for warnings).

### 4b. Colours at import (extends items 2–4)

- **save-plan**: also accept optional `colorPalette` (array of `#RRGGBB`
  strings); persist to `monthly_plans.color_palette` with the same
  only-when-provided rule as `styleCategory`; empty array stores NULL.
- **planning page**: next to the style select, an optional text input for
  colour codes (placeholder like `#1A1A2E, #D4AF37 — colours for this plan (optional)`).
  Parse on save: split on commas/spaces, keep `#RRGGBB` matches (a bare
  `RRGGBB` gets its `#` added), drop the rest. Pass the parsed array as
  `colorPalette` in both the auto-save and the manual "Keep my slots" save.
  Show small colour chips next to the input for the codes it recognised.
- **designer** (src/lib/post-designer.ts) — **DONE**: when
  `monthly_plans.color_palette` has entries, those replace Brand Brain colours
  in the art-director prompt and are declared binding; part of the design
  hash, so changing them re-designs the plan.

### 5. Verification

- `npx tsc --noEmit` must pass.
- Manual check described to the founder: import a plan with a style chosen →
  art direction panel appears → open 5b → the style dropdown shows the chosen
  style → prompt preview reflects that style's house look.

## Out of scope

- No prompt text is generated at import.
- The Shwetanki brand-colour question (#000000 + gold vs warm ivory) is a
  separate founder decision, not part of this change.
