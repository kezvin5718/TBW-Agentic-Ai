import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_CHATGPT, MODEL_FAST } from "@/lib/llm-config";
import { describeImageViaVision } from "@/lib/integrations/openai-images";

export const dynamic = "force-dynamic";

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

/**
 * POST /api/social-publisher/generate-caption
 * Body: { clientId, platform, contentType, brief?, model?, mediaUrl?, mediaIsVideo?, thumbnailUrl? }
 * Writes a platform-ready caption grounded in what's actually attached (the
 * creative or reel) and the full brand memory — not just a name and a brief.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clientId, platform, contentType, brief, model, mediaUrl, mediaIsVideo, thumbnailUrl } = await request.json();
  if (!clientId) return NextResponse.json({ error: "Select a client first" }, { status: 400 });

  const { data: client } = await supabase.from("clients").select("name, products, target_audience").eq("id", clientId).single();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const { data: brain } = await supabase
    .from("brand_brain")
    .select("brand_brief, caption_tone, design_preferences, feedback_log, addresses")
    .eq("client_id", clientId)
    .maybeSingle();

  // What's actually attached — a caption written blind to the creative reads
  // generic. A still image gets described directly; a reel falls back to its
  // thumbnail (a real video description isn't worth a transcription pass here).
  let visual = "";
  const stillToRead = !mediaIsVideo ? mediaUrl : thumbnailUrl;
  if (stillToRead) {
    try {
      visual = await describeImageViaVision(
        stillToRead,
        "Describe exactly what is shown in this social media creative: the product, setting, colours, mood, and any text visible on it. Under 60 words, factual only."
      );
    } catch { /* caption still works without it */ }
  }

  const { notes, rules } = splitPreferences((brain?.design_preferences as unknown[]) || []);
  const addr = ((brain?.addresses as AddressEntry[]) || [])[0];
  const hasContact = !!(addr?.address || addr?.phone);
  const hashtagCount = rules.hashtags || "3-6";
  const keywordCount = rules.seo_keywords || "5-8";
  const feedbackDigest = Array.isArray(brain?.feedback_log)
    ? (brain!.feedback_log as unknown[]).slice(-5).map((f) => (typeof f === "string" ? f : JSON.stringify(f))).join("\n")
    : "";

  const chosenModel = model === "gemini" ? MODEL_FAST : MODEL_CHATGPT;

  const caption = await complete({
    system:
      "You are the senior social media copywriter at TBW Advertising. Write ONE ready-to-post caption grounded in the actual creative and the brand's own corrected rules — never invent product details, offers, or prices. Output ONLY the caption text — no options, no quotes, no explanations.",
    messages: [{
      role: "user",
      content: `Write a ${platform || "instagram"} ${contentType || "post"} caption for the brand "${client.name}".

${visual ? `What's actually in the attached ${mediaIsVideo ? "reel" : "creative"}: ${visual}` : mediaIsVideo ? "This is a video/reel — no still available to describe, write from the brief only." : "No creative attached yet — write from the brief only."}

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

Format the caption in EXACTLY this structure — a blank line between every block, nothing merged together, no markdown:

<hook line, 1-2 emoji at the end>
<blank line>
<1-2 short sentences describing the piece and the occasion it suits — grounded in what's actually in the creative>
<blank line>
<one closing tagline line — no emoji>
<blank line>
📍 <address>
📞 <phone>
<blank line>
🏷️ <${keywordCount} plain comma-separated keyword phrases — lowercase, no # symbol, built from the product/category, brand name, and occasion>
<blank line>
<${hashtagCount} hashtags on one line, space-separated, each starting with #>

${hasContact ? `Use this exact address and phone in the 📍/📞 lines: ${addr!.address || ""} / ${addr!.phone || ""}` : "No address or phone is on file for this brand — leave out the 📍/📞 block entirely, including its blank lines."}

Output only the caption, nothing else.`,
    }],
    model: chosenModel,
    maxTokens: 400,
  });

  return NextResponse.json({ success: true, caption: caption.trim(), model: chosenModel });
}
