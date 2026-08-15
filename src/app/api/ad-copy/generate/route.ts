import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, safeJsonParse } from "@/lib/llm";
import { MODEL_CHATGPT, MODEL_FAST } from "@/lib/llm-config";
import { describeImageViaVision } from "@/lib/integrations/openai-images";
import { downloadDriveFileByUrl } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Ten vision calls plus a copy pass — comfortably past the default budget.
export const maxDuration = 300;

/** Meta's carousel/catalogue ad tops out at 10 cards. */
const MAX_IMAGES = 10;
/** Meta clips the headline to roughly 25-40 chars, so 2-3 words is the brief. */
const HEADLINE_MAX_WORDS = 3;

interface AddressEntry { address?: string; phone?: string; city?: string; state?: string; label?: string }

/** design_preferences mixes plain style notes with structured objects the founder has corrected — split them apart. */
function splitPreferences(prefs: unknown[]): { notes: string[]; rules: Record<string, unknown> } {
  const notes: string[] = [];
  const rules: Record<string, unknown> = {};
  for (const p of prefs || []) {
    if (typeof p === "string") notes.push(p);
    else if (p && typeof p === "object") Object.assign(rules, p as Record<string, unknown>);
  }
  return { notes, rules };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * Google serves Drive images from a CDN that third parties can't always fetch —
 * the same reason video frames are pulled server-side. Handing the vision model
 * a naked Drive link fails silently and every headline turns generic, so the
 * bytes are inlined instead.
 */
async function toVisionSource(url: string): Promise<string> {
  if (!/googleusercontent\.com|drive\.google\.com/.test(url)) return url;
  try {
    const buf = await downloadDriveFileByUrl(url);
    if (!buf || buf.length === 0) return url;
    const mime =
      buf[0] === 0x89 ? "image/png"
      : buf[0] === 0x47 ? "image/gif"
      : buf[8] === 0x57 ? "image/webp"
      : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return url;
  }
}

/** Strip the quotes, trailing punctuation and stray markdown a model likes to add. */
function tidyHeadline(s: string): string {
  return String(s || "")
    .replace(/[*_`#]/g, "")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/[.,;:!]+$/, "")
    .trim();
}

/**
 * POST /api/ad-copy/generate
 *
 * Writes the copy for ONE Meta carousel/catalogue ad: a single Primary text
 * shared by the whole ad, plus a 2-3 word Headline per card, each read off the
 * image it belongs to and grounded in that client's Brand Brain.
 *
 * This generates text only — nothing here touches the Meta API and no ad, ad
 * set or campaign is created. The team copies the output into Ads Manager.
 *
 * Body: { clientId, images: [{ url, name? }] }  (1-10 images)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { clientId, model } = body;
  const images: Array<{ url: string; name?: string }> = Array.isArray(body.images) ? body.images : [];

  if (!clientId) return NextResponse.json({ error: "Select a client — the copy comes from their Brand Brain." }, { status: 400 });
  if (images.length === 0) return NextResponse.json({ error: "Add at least one image." }, { status: 400 });
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: `That is ${images.length} images — Meta allows at most ${MAX_IMAGES} cards in one carousel.` }, { status: 400 });
  }
  if (images.some((i) => !i?.url)) return NextResponse.json({ error: "One of the images has no URL." }, { status: 400 });

  const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const { data: brain } = await supabase
    .from("brand_brain")
    .select("brand_brief, caption_tone, design_preferences, feedback_log, addresses")
    .eq("client_id", clientId)
    .maybeSingle();

  // Read every card at once. Serially this was ten round-trips of dead time,
  // and the whole point of the screen is that it finishes in one click.
  const described = await Promise.all(
    images.map(async (img) => {
      try {
        const seen = await describeImageViaVision(
          await toVisionSource(img.url),
          "Describe the product in this advertising image: what the item actually is (be specific — e.g. men's gold chain, crown-style ring, om pendant), its style, metal/material and colour. Under 35 words, factual only, no marketing language."
        );
        return { ...img, seen: seen || "" };
      } catch {
        return { ...img, seen: "" };
      }
    })
  );

  // Vision silently returns "" when no API key is configured. Without it every
  // headline would be invented, so say so rather than handing back fiction.
  const sawNothing = described.every((d) => !d.seen);

  const { notes, rules } = splitPreferences((brain?.design_preferences as unknown[]) || []);
  const addr = ((brain?.addresses as AddressEntry[]) || [])[0];
  const hasContact = !!(addr?.address || addr?.phone);
  const feedbackDigest = Array.isArray(brain?.feedback_log)
    ? (brain!.feedback_log as unknown[]).slice(-5).map((f) => (typeof f === "string" ? f : JSON.stringify(f))).join("\n")
    : "";

  const chosenModel = model === "gemini" ? MODEL_FAST : MODEL_CHATGPT;

  const cardList = described
    .map((d, i) => `Card ${i + 1}${d.name ? ` (file: ${d.name})` : ""}: ${d.seen || "[image could not be read — write a safe, generic headline for this brand's category]"}`)
    .join("\n");

  const contactBlock = hasContact
    ? `Finish with exactly these two lines, verbatim:\n📍 ${addr!.address || ""}\n📞 ${addr!.phone || ""}`
    : "No address or phone is on file for this brand — do NOT invent one and leave out the 📍/📞 lines entirely.";

  const askFor = (extra = "") => complete({
    system:
      "You are the senior performance copywriter at TBW Advertising, writing Meta carousel ad copy. Ground every word in the actual product images and the brand's own corrected rules. Never invent offers, prices, discounts, guarantees or product details you cannot see. Reply with JSON only.",
    model: chosenModel,
    maxTokens: 1400,
    messages: [{
      role: "user",
      content: `Write the copy for ONE Meta carousel ad for the brand "${client.name}".

There are ${described.length} cards. Here is what is actually in each image:
${cardList}

Brand brief:
${(brain?.brand_brief || "None").slice(0, 2000)}

Tone: ${brain?.caption_tone || "warm, confident, not pushy"}
Style notes: ${notes.slice(0, 6).join(" | ") || "none"}
${Object.keys(rules).length ? `Structured brand rules: ${JSON.stringify(rules).slice(0, 600)}` : ""}

Rules and corrections the founder has explicitly given for this brand — follow these exactly, they override any general instinct:
${feedbackDigest || "None recorded yet."}

Produce:

1. "primaryText" — the single body text shared by the whole ad. Structure it exactly like this:
   - one short hook line (under 10 words)
   - a blank line
   - exactly 4 bullet lines, each starting with "• ", each under 9 words
   - a blank line
   - ${contactBlock}
   No hashtags. No emoji other than the 📍 and 📞 shown above.

2. "headlines" — an array of exactly ${described.length} strings, one per card IN ORDER.
   HARD RULE: every headline must be 2 or 3 words. Never 1, never 4 or more.
   Each names the specific product visible in THAT card's image (e.g. "Men's Gold Chain", "Crown Gold Ring", "Om Pendant").
   Title Case. No punctuation, no quotes, no brand name, no adjectives that aren't needed.
   Every headline must be different from the others.
${extra}
Reply with JSON only, in this exact shape:
{"primaryText":"...","headlines":["...","..."]}`,
    }],
  });

  let parsed = safeJsonParse<{ primaryText?: string; headlines?: unknown }>(await askFor(), {});
  let headlines = (Array.isArray(parsed.headlines) ? parsed.headlines : []).map((h) => tidyHeadline(String(h)));

  // The word cap is the one instruction models reliably ignore, and a 6-word
  // headline is clipped mid-phrase by Meta. Ask once more naming the offenders,
  // then trim what still doesn't comply — the team should never see a long one.
  const tooLong = headlines.filter((h) => words(h).length > HEADLINE_MAX_WORDS);
  if (headlines.length !== described.length || tooLong.length > 0) {
    const retry = safeJsonParse<{ primaryText?: string; headlines?: unknown }>(
      await askFor(
        `\nYour previous attempt was rejected: ${
          headlines.length !== described.length
            ? `it returned ${headlines.length} headlines instead of ${described.length}.`
            : `these headlines were longer than ${HEADLINE_MAX_WORDS} words: ${tooLong.join(", ")}.`
        } Return exactly ${described.length} headlines of 2-3 words each.\n`
      ),
      {}
    );
    const retryHeads = (Array.isArray(retry.headlines) ? retry.headlines : []).map((h) => tidyHeadline(String(h)));
    if (retryHeads.length === described.length) {
      headlines = retryHeads;
      if (retry.primaryText) parsed = { ...parsed, primaryText: retry.primaryText };
    }
  }

  const cards = described.map((d, i) => {
    const raw = headlines[i] || "";
    const w = words(raw);
    // Last resort so nothing over the cap ever reaches Ads Manager.
    const headline = w.length > HEADLINE_MAX_WORDS ? w.slice(0, HEADLINE_MAX_WORDS).join(" ") : raw;
    return {
      url: d.url,
      name: d.name || "",
      headline,
      trimmed: w.length > HEADLINE_MAX_WORDS,
      imageRead: !!d.seen,
    };
  });

  return NextResponse.json({
    success: true,
    primaryText: String(parsed.primaryText || "").trim(),
    cards,
    // Surfaced in the UI: without vision the headlines are guesses, not reads.
    warning: sawNothing
      ? "No image could be read — OPENROUTER_API_KEY / OPENAI_API_KEY looks unset, so these headlines are generic rather than based on your images."
      : cards.some((c) => !c.imageRead)
        ? "Some images could not be read; those headlines are generic — check them before using."
        : null,
  });
}
