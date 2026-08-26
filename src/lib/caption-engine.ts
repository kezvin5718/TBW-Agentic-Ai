import { createServiceRoleClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_CHATGPT, MODEL_FAST } from "@/lib/llm-config";
import { describeImageViaVision } from "@/lib/integrations/openai-images";
import { readCreative } from "@/lib/creative-reader";

/**
 * The one place a caption is written.
 *
 * This used to live inside its route, which meant every other part of the app
 * reached it by making an HTTP call to itself and forwarding the browser's
 * cookie. In production that hop loses the session — which is why the
 * background caption writer had produced exactly zero captions, and why the
 * fifteen recorded failures are all the same failure. A function call has no
 * origin, no cookie, no middleware and no redirect to lose anything to.
 *
 * Reads go through the service-role client: the same tables, without depending
 * on whose session happened to be in flight.
 */

interface AddressEntry { address?: string; phone?: string; city?: string; state?: string; label?: string }

export interface CaptionInput {
  clientId: string;
  platform?: string;
  contentType?: string;
  brief?: string;
  model?: string;
  mediaUrl?: string;
  mediaIsVideo?: boolean;
  thumbnailUrl?: string;
  visionDescription?: string;
  onCreativeText?: string;
}

export type CaptionEngineResult =
  | { ok: true; caption: string; model: string; bodyWords: number }
  | { ok: false; error: string; code?: string };

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

/**
 * Writes a platform-ready caption grounded in what's actually attached (the
 * creative or reel) and the full brand memory — not just a name and a brief.
 */
export async function writeCaptionForClient(input: CaptionInput): Promise<CaptionEngineResult> {
  const { clientId, platform, contentType, brief, model, mediaUrl, mediaIsVideo, thumbnailUrl } = input;
  if (!clientId) return { ok: false, error: "Select a client first" };

  const admin = createServiceRoleClient();
  const { data: client } = await admin.from("clients").select("name, products, target_audience").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Client not found", code: "no_client" };
  const { data: brain } = await admin
    .from("brand_brain")
    .select("brand_brief, caption_tone, design_preferences, feedback_log, addresses")
    .eq("client_id", clientId)
    .maybeSingle();

  // What's actually on the creative. A caption written blind reads generic, and
  // worse, invents details — so the creative is read properly: every part of a
  // video, not just its cover, and the text on it copied out word for word.
  //
  // The old path took the thumbnail for a video, and a Content Hub reel rarely
  // has one, so this came back empty and the model wrote from the brand brief
  // alone. A price shown on screen never reached the caption.
  let visual = String(input.visionDescription || "").trim();
  let onCreativeText = String(input.onCreativeText || "").trim();

  if (!visual && !onCreativeText && mediaUrl) {
    try {
      const reading = await readCreative(mediaUrl, mediaIsVideo ? "video" : "image");
      visual = reading.description;
      onCreativeText = reading.onCreativeText;
      // A video that could not be sampled still has its cover to fall back on.
      if (!visual && mediaIsVideo && thumbnailUrl) {
        visual = await describeImageViaVision(
          thumbnailUrl,
          "Describe exactly what is shown in this social media creative: the product, setting, colours, mood, and any text visible on it. Under 60 words, factual only."
        );
      }
    } catch { /* caption still works without it */ }
  }

  const { notes, rules } = splitPreferences((brain?.design_preferences as unknown[]) || []);
  const addr = ((brain?.addresses as AddressEntry[]) || [])[0];

  // Both are required on every caption. There is no way to write one without
  // them and no acceptable way to fill the gap: an invented address or a made-up
  // phone number on a live jewellery post is worse than no post at all. So this
  // refuses, names what is missing, and says where to add it.
  const missingContact = [!addr?.address && "address", !addr?.phone && "phone number"].filter(Boolean);
  if (missingContact.length > 0) {
    return {
      ok: false,
      error: `${client.name} has no ${missingContact.join(" or ")} on file, and every caption must carry both. Add it in Brand Brain → ${client.name}, then generate again.`,
      code: "missing_contact",
    };
  }
  const hashtagCount = rules.hashtags || "3-6";
  const keywordCount = rules.seo_keywords || "5-8";
  const feedbackDigest = Array.isArray(brain?.feedback_log)
    ? (brain!.feedback_log as unknown[]).slice(-5).map((f) => (typeof f === "string" ? f : JSON.stringify(f))).join("\n")
    : "";

  const chosenModel = model === "gemini" ? MODEL_FAST : MODEL_CHATGPT;

  const caption = await complete({
    purpose: "captions",
    system:
      "You are the senior social media copywriter at TBW Advertising. Write ONE ready-to-post caption grounded in the actual creative and the brand's own corrected rules — never invent product details, offers, or prices. Output ONLY the caption text — no options, no quotes, no explanations.",
    messages: [{
      role: "user",
      content: `Write a ${platform || "instagram"} ${contentType || "post"} caption for the brand "${client.name}".

${visual ? `What's actually in the attached ${mediaIsVideo ? "reel" : "creative"}: ${visual}` : mediaIsVideo ? "This is a video/reel — no still available to describe, write from the brief only." : "No creative attached yet — write from the brief only."}
${onCreativeText ? `
TEXT PRINTED ON THE CREATIVE, copied word for word:
${onCreativeText}

These are the facts the creative itself is making. Any price, weight, purity, carat, discount, scheme name, date or offer above must appear in the caption EXACTLY as written — same number, same currency, same spelling. Do not round "₹45,999" to "45,000", do not turn "22KT 916 Hallmark" into "22 carat", and do not add a figure that is not in that list. If the creative names a price, the caption must not read as though it has no price.` : `
No text was readable on the creative, so state no price, weight, purity, discount or offer of any kind — there is nothing to take one from, and inventing one is the single worst thing this caption can do.`}

Brand tone: ${brain?.caption_tone || "professional, warm"}
Target audience: ${client.target_audience || "general"}
Products: ${JSON.stringify(client.products || [])}
Brand brief:
${(brain?.brand_brief || "None").slice(0, 2000)}

Style notes from brand memory:
${notes.slice(0, 8).join("\n") || "none recorded"}

Rules and corrections the founder has explicitly given for this brand — follow these exactly, they override any general instinct:
${JSON.stringify(rules)}
${feedbackDigest ? `\nRecent feedback on past posts:\n${feedbackDigest}` : ""}

${brief ? `What this post is about: ${brief}` : "Write something on-brand and engaging for this brand."}

LENGTH — this matters. The written part of the caption (the hook, the body and the closing line together) must be between 100 and 120 words. That is a real paragraph, not two lines: describe the piece, the craft, the occasion it suits and who it is for, drawing on what is actually in the creative. Count only those words — the 📍/📞 lines, the keyword line and the hashtags are not part of the count.

Format the caption in EXACTLY this structure — a blank line between every block, nothing merged together, no markdown:

<hook line, 1-2 emoji at the end>
<blank line>
<the body: several sentences on the piece, its craftsmanship and the occasion it suits, grounded in what's actually in the creative. This is where nearly all of the 100-120 words live.>
<blank line>
<one closing tagline line — no emoji>
<blank line>
📍 <address>
📞 <phone>
<blank line>
🏷️ <${keywordCount} plain comma-separated keyword phrases — lowercase, no # symbol, built from the product/category, brand name, and occasion>
<blank line>
<${hashtagCount} hashtags on one line, space-separated, each starting with #>

The 📍 and 📞 lines are mandatory and must both appear, exactly as given here — never altered, never abbreviated, never left out:
📍 ${addr!.address}
📞 ${addr!.phone}

The address and phone number appear EXACTLY ONCE in the whole caption — only in those two lines. Never mention the address, the location, or the phone number anywhere else: not in the hook, not in the body, not in the closing line.

Output only the caption, nothing else.`,
    }],
    model: chosenModel,
    // A 100-120 word body plus the contact block, keywords and hashtags does not
    // fit in 400 — the old limit cut captions off mid-sentence.
    maxTokens: 900,
  });

  const text = caption.trim();

  // The contact block must appear exactly once — no more, no fewer. The old
  // check appended it whenever the model's wording didn't match the stored text
  // character-for-character, so a restyled phone number meant the founder saw
  // the address twice. Rebuilding is surer than matching: strip every 📍/📞
  // line the model wrote, then place the canonical block once, where the
  // format says it goes — after the body, before the keywords.
  const contactBlock = `📍 ${addr!.address}\n📞 ${addr!.phone}`;
  const kept = text.split("\n").filter((l) => !/^\s*[📍📞]/u.test(l));
  const tail = kept.findIndex((l) => /^\s*(🏷️|#)/u.test(l));
  if (tail === -1) kept.push("", contactBlock);
  else kept.splice(tail, 0, contactBlock, "");
  const withContact = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Reported so a caption that came back far short of the brief is visible
  // rather than being discovered at posting time.
  const bodyWords = withContact
    .split("\n")
    .filter((l) => !/^\s*(📍|📞|🏷️|#)/.test(l))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  return { ok: true, caption: withContact, model: chosenModel, bodyWords };
}
