/**
 * Free-hand test authorised by the founder: does the corrected prompt shape —
 * palette named in hexes, house framing described, dark forbidden — actually
 * bring back Shwetanki-coloured scenes from the real image model? Two
 * generations, written to the scratchpad for side-by-side judgement against
 * the founder's own grid.
 *
 * Run: set -a; source .env; set +a; npx tsx scripts/palette-test.ts <outdir>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateBrandImage } from "../src/lib/integrations/openai-images";

const outDir = process.argv[2] || ".";

const COLOUR_WORLD =
  "Colour world — the scene lives in tints and shades of exactly these: #ab6364 dusty rose, #f3ece4 warm ivory, #5b3a3b deep maroon. No other colour family may dominate. No black, no charcoal, no grey, no dark backgrounds of any kind.";

const SUFFIX = `
Style: premium Indian advertising background for a jewellery brand. Rich but uncluttered, with clear empty space across the lower half where text will be placed afterwards.
Absolutely no text, no letters, no numbers, no logos, no watermarks, no people, and no jewellery or products of any kind. Background scene only.`;

const TESTS = [
  {
    name: "offer-panel",
    prompt: `A warm ivory paper background in soft diffused studio light. A centred rectangular panel in dusty rose (#ab6364) with a thin ornamental gold-line border, occupying the upper middle of the frame. Around the outer edges, an organic frame of gnarled dark vines dotted with small pale-blue and purple blossoms, editorial and painterly. Soft shadows, matte print-like finish.
${COLOUR_WORLD}${SUFFIX}`,
  },
  {
    name: "brand-story",
    prompt: `A warm ivory textured plaster wall washed in gentle window light from the left, with a soft arch-shaped glow in the centre. Along the bottom and side edges, an elegant border of intertwined vines carrying deep maroon ranunculus and tiny violet flowers, painterly and editorial. Quiet, luxurious, matte finish.
${COLOUR_WORLD}${SUFFIX}`,
  },
];

async function main() {
  for (const t of TESTS) {
    console.log(`→ generating "${t.name}"…`);
    const { buffer, error } = await generateBrandImage(t.prompt, "square");
    if (!buffer) {
      console.error(`   ✗ ${t.name}: ${error}`);
      continue;
    }
    const path = join(outDir, `palette-${t.name}.png`);
    writeFileSync(path, buffer);
    console.log(`   ✓ wrote ${path}`);
  }
}
main();
