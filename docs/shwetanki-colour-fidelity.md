# Colour fidelity in 5b — senior review vs the real Shwetanki grid

## The evidence

The founder fixed the plan palette to `#ab6364` (dusty rose) at import. The
designer's output for the same plan:

| Item | backgroundHex | accentHex | textHex | Scene prompt says |
|---|---|---|---|---|
| 2 | `#1a1210` (near-black) | `#ab6364` | `#f0e6d3` | "dark charcoal stone surface" |
| 5 | `#1c1410` (near-black) | `#ab6364` | `#f0e6d3` | "dark polished stone surface" |
| 6 | `#1a1210` (near-black) | `#ab6364` | `#f0e6d3` | "matte dark charcoal surface" |

The founder's colour was demoted to an accent; the background — the colour
that IS the creative — was invented, and invented dark.

The real Shwetanki grid (designer-made, the ground truth): warm ivory and
blush grounds, a dusty-rose panel exactly `#ab6364`-family, ornate serif
display type with script italic accents in deep maroon, the SHWETANKI logo top
centre, and organic vine-and-flower borders framing every frame. Editorial,
warm, floral — nothing charcoal anywhere.

## Root causes, ranked

1. **The palette rule is advisory where it must be mechanical.** The prompt
   says colours must "come from or harmonise with" the plan palette. With a
   one-colour palette the model cannot source bg+text+accent from the list, so
   "harmonise" becomes licence — and it harmonised toward dark because of
   causes 2–4.
2. **Poisoned examples inside Brand Brain.** Shwetanki's `design_preferences`
   contain feedback entries that cite `#1A1A1A` backgrounds as worked
   examples ("e.g., backgroundHex #1A1A1A", "light text #F5F0EA on #1A1A1A").
   The designer reads these as house palette. The chosen backgrounds
   (`#1a1210`) are near-copies of that example hex.
3. **The scene prompt never hears the palette.** `buildScenePrompt` sends the
   scene text + style block; the plan colours are not named in the image
   prompt at all, so even a correct spec would get a scene drawn in whatever
   palette the model fancies.
4. **The style digest's words skew dark** ("moody, rich shadows, avoid bright
   colours") because the library's references are other brands' extractions —
   `style_presets` has no client link, so Shwetanki is styled by other
   brands' moods.
5. **Typography gap (separate from colour).** The compositor sets everything
   in DejaVu Sans bold caps — the only font in the container. The brand's
   grid is ornate serif. Right colours under wrong type will still read wrong.

## The fix (spec for the junior developer)

### A. Make the palette law — src/lib/post-designer.ts
- When `planColors` exist, replace the soft sentence with mechanical rules:
  backgroundHex MUST be a plan colour or a light tint of one (same hue,
  raised lightness — e.g. `#ab6364` may become a blush `#e8c8c9` or warm
  ivory `#f3ece4` derived from it); dark/black/charcoal backgrounds are
  FORBIDDEN unless the row's productionNote itself demands dark; textHex must
  be a deep shade of a plan colour or near-black ONLY as text; accentHex from
  the list. scenePrompt must name the palette world in words and hexes.
- Add: "Hex codes quoted inside style notes or past corrections are examples
  from old work, NOT this plan's palette — the plan palette overrides them."
- Add a `PROMPT_VERSION` string to the design-hash input so every prompt-rule
  change re-designs plans on the next visit (today only data changes bust the
  cache; code changes silently don't).

### B. The image prompt hears the palette — src/lib/post-designer.ts + post-studio.ts
- `PostSpec` gains `palette?: string[]`; the designer fills it with the plan
  colours (or brand colours as fallback).
- `buildScenePrompt` appends, when palette is present:
  `Colour world — the scene lives in tints and shades of exactly these:
  <hexes>. No other colour family may dominate.`

### C. Serif typography — Dockerfile + src/lib/post-studio.ts
- Vendor an OFL serif display font into the repo (`fonts/` — Cormorant
  Garamond bold + regular from Google Fonts' GitHub, licence file alongside),
  COPY into the image, `fc-cache` (Dockerfile already does this for DejaVu).
- `PostSpec` gains `typeStyle?: "serif" | "sans"`; the designer chooses from
  the house look (jewellery editorial refs → serif). `textLayer` uses the
  serif family for headline + subtext when `typeStyle === "serif"`
  (font-family "Cormorant Garamond", fallback DejaVu Serif), keeps the CTA
  pill in sans. Width measurement: reuse the existing glyphEm table — serif
  advances are narrower than the bold-sans estimates, so the measurements
  stay safe (over-estimate never clips).

### D. Client-owned style references — migration + style-library.ts + upload UI
- `style_presets.client_id uuid null` (migration; the reviewer applies it —
  the junior does NOT touch the DB).
- Upload UI gets an optional client picker; extraction stores it.
- `houseLookDigest(category, clientId?)` and `styleBlockFor(spec, category,
  clientId?)` prefer rows of that client when any exist, else fall back to
  the global shelf. `analysePlan`/`generatePlanPosts` pass the plan's client.
- Then the founder uploads the real Shwetanki grid frames to the library as
  Shwetanki-only references — after which the digest describes THIS brand.

### E. Verification (the reviewer's free-hand test)
- 2–3 live generations through the real image model with the corrected
  prompt shape, composited with the serif type over `#ab6364`-family grounds,
  compared side-by-side with the founder's grid.
