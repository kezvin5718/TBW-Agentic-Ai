/**
 * Renders one frame through the REAL compositor — same code the Build button
 * runs — with the exact Surat headline that clipped to "DIAMONI", but with no
 * scene generation (so it costs nothing and needs no API keys or network).
 * The result is written next to the project as render-test.jpg.
 *
 * Run from the project folder:  npx tsx scripts/render-test.ts
 */
import { writeFileSync } from "node:fs";
import { renderFrame } from "../src/lib/post-studio";
import type { PostSpec } from "../src/lib/post-designer";

const spec: PostSpec = {
  item: 1,
  date: null,
  platform: "instagram",
  contentType: "post",
  kind: "generated",
  frames: 1,
  headline: "The world's diamonds are cut here. Now they'll be worn here.",
  subtext: "From Surat's cutting tables to Surat's celebrations.",
  cta: "Visit the store",
  backgroundHex: "#1a1a2e",
  accentHex: "#d4af37",
  textHex: "#f5f0e6",
  scenePrompt: "", // empty on purpose — plain brand canvas, no image model, no cost
  reason: "layout test",
};

renderFrame(spec).then(({ buffer }) => {
  writeFileSync("render-test.jpg", buffer);
  console.log("✅ Wrote render-test.jpg — open it and read the headline edge to edge.");
});
