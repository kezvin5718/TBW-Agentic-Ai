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
  const { data: client } = await admin.from("clients").select("name, products, target_audience, social_accounts").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Client not found", code: "no_client" };
  const { data: brain } = await admin
    .from("brand_brain")
    .select("brand_brief, caption_tone, design_preferences, feedback_log, addresses, caption_signature")
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
  // The founder's format (1 Oct): exactly 8 keywords and exactly 5 hashtags —
  // unless a brand's own corrected rules say otherwise, which win as always.
  const hashtagCount = rules.hashtags || "exactly 5";
  const keywordCount = rules.seo_keywords || "exactly 8";
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

${brief ? `What this post is about / offer details supplied for this post: ${brief}` : "No offer or special instruction was supplied for this post."}
${rules.current_offer ? `Current offer on record for this brand: ${JSON.stringify(rules.current_offer)}` : ""}

FIRST, decide what kind of content this actually is — a product showcase, a customer testimonial or happy-customer video, a bridal video, an offer/promotion, a new collection, a store experience, an educational piece, an event, festive content, or behind-the-scenes — and write for THAT, not a product ad by default:
- Testimonial / happy customer → write about the customer's happiness, trust and experience with the brand. If a customer's NAME is printed on the creative, use it naturally.
- Product showcase / new collection → name the product (or the honest broader category) and describe its visible design, detailing, craftsmanship or appeal.
- Bridal → bridal moments, wedding styling, the jewellery's place in the day.
- Offer / promotion → lead with the offer naturally — but ONLY an offer stated in the supplied details above or printed on the creative itself. Never one of your own.
- Store / brand video → the shopping experience, the service, the feeling of the place.
- Festive → connect the creative to the occasion it is for.
Do not describe your analysis anywhere in the output.

Format the caption in EXACTLY this structure — a blank line between every block, nothing merged together, no markdown:

<ONE short hook line — a single line, engaging, natural, matched to the MOOD of this creative. Not a long sentence, not a generic AI opener, not the same style of opening every time. An emoji only if it suits this brand's tone.>
<blank line>
<the main passage: 2 to 3 natural lines written for the content type you identified — flowing like a professionally written Instagram caption, grounded only in what is actually visible and the supplied details.>
<blank line>
🏷️ <${keywordCount} plain comma-separated SEO keyword phrases — lowercase, no # symbol, drawn from the brand, the content, the product or category, the offer when there is one, and the location. No near-duplicate keywords.>
<blank line>
<${hashtagCount} hashtags on one line, space-separated, each starting with #. Include the brand's own hashtag. Relevant to this actual creative — nothing spammy or generic.>

STYLE REFERENCE — match this flow, structure and level of detail, but copy NOTHING from it (not the brand, address, phone, offer, figures, wording, keywords or hashtags; all of that comes from the current creative and the current brand only):
"Happy customers make every sparkle more special. ✨

Nothing speaks louder than the experience of our customers. At Raamya Jewels, we're delighted to see families finding jewellery they love while enjoying exceptional value with 6.5% making charges on yellow gold jewellery.
Their smiles, trust and experience are what make every visit truly special."

HARD RULES:
- Never guess or invent weight, purity, material, price, making charges, discount, certification, gemstone, collection name or offer — only what the creative's own printed text or the supplied details state.
- Never write "in this video", "in this image", "the uploaded video" or "I can see" — write it as ready-to-post copy.
- Never use an em dash (—) anywhere.
- Do not repeat the brand name unnecessarily.
- Do not write the address, phone number, Instagram handle or website anywhere — those lines are appended automatically and must not be duplicated.
- Do not write "follow @…" or cross-account promotion lines — those are appended automatically too.
- Plain, premium, simple English. No complicated vocabulary, no robotic wording, no excessive adjectives, nothing overly poetic.

Output only the caption, nothing else — no options, no explanations.`,
    }],
    model: chosenModel,
    maxTokens: 700,
  });

  // The founder banned em dashes outright; a model that slips one through is
  // corrected here rather than argued with.
  let text = caption.trim().replace(/\s*—\s*/g, ", ");

  // Exactly 8 keywords and exactly 5 hashtags — enforced, not hoped for. Only
  // when the brand has no override of its own: a founder-corrected count wins.
  if (!rules.seo_keywords) {
    text = text.replace(/^(\s*🏷️\s*)(.+)$/mu, (_, pre: string, list: string) => {
      const parts = list.split(",").map((s) => s.trim()).filter(Boolean);
      return pre + parts.slice(0, 8).join(", ");
    });
  }
  if (!rules.hashtags) {
    text = text.replace(/^((?:#[^\s#]+\s*){6,})$/m, (line) =>
      (line.match(/#[^\s#]+/g) || []).slice(0, 5).join(" ")
    );
  }

  // The contact block must appear exactly once — no more, no fewer. The old
  // check appended it whenever the model's wording didn't match the stored text
  // character-for-character, so a restyled phone number meant the founder saw
  // the address twice. Rebuilding is surer than matching: strip every 📍/📞
  // line the model wrote, then place the canonical block once, where the
  // format says it goes — after the body, before the keywords.
  //
  // A brand may also end every caption with a fixed sign-off — the follow-lines
  // for its other accounts. It is placed here rather than asked of the model for
  // the same reason as the address: written by hand it comes out verbatim and
  // once, and the model is told not to write follow-lines at all.
  const signature = String(brain?.caption_signature || "").trim();
  const signatureLines = new Set(signature.split("\n").map((l) => l.trim()).filter(Boolean));
  // The client-details block, built from backend data alone — the model never
  // types these. Address and phone are guaranteed above; the Instagram handle
  // and website print only when they exist, no placeholders ever.
  const socials = (client.social_accounts || {}) as Record<string, unknown>;
  const insta = String(socials.instagram || "").trim();
  const site = String(socials.website || "").trim();
  const contactBlock = [
    `📍 Visit us: ${addr!.address}`,
    `📞 Call: ${addr!.phone}`,
    insta ? `📩 DM ${insta.startsWith("@") || insta.startsWith("http") ? insta : `@${insta}`}` : null,
    site ? `🌐 ${site}` : null,
  ].filter(Boolean).join("\n");
  const block = signature ? `${contactBlock}\n\n${signature}` : contactBlock;
  // A model that has seen this brand's past captions may reproduce a follow-line
  // itself; an exact repeat of one is dropped so the sign-off cannot double.
  const kept = text
    .split("\n")
    .filter((l) => !/^\s*[📍📞📩🌐]/u.test(l) && !signatureLines.has(l.trim()));
  const tail = kept.findIndex((l) => /^\s*(🏷️|#)/u.test(l));
  if (tail === -1) kept.push("", block);
  else kept.splice(tail, 0, block, "");
  const withContact = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Reported so a caption that came back far short of the brief is visible
  // rather than being discovered at posting time. The sign-off is matched line
  // for line rather than by its "For " opening, so a body sentence that happens
  // to begin with "For" still counts toward the length.
  const bodyWords = withContact
    .split("\n")
    .filter((l) => !/^\s*(📍|📞|📩|🌐|🏷️|#)/.test(l) && !signatureLines.has(l.trim()))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  return { ok: true, caption: withContact, model: chosenModel, bodyWords };
}
