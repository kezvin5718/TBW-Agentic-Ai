import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete } from "@/lib/llm";
import { MODEL_CHATGPT, MODEL_FAST } from "@/lib/llm-config";

export const dynamic = "force-dynamic";

/**
 * POST /api/social-publisher/generate-caption
 * Body: { clientId, platform, contentType, brief?, model? ("chatgpt" | "gemini") }
 * Writes a platform-ready caption using the client's Brand Brain (brief + tone).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  if (!user || !["founder", "employee"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { clientId, platform, contentType, brief, model } = await request.json();
  if (!clientId) return NextResponse.json({ error: "Select a client first" }, { status: 400 });

  const { data: client } = await supabase.from("clients").select("name, products, target_audience").eq("id", clientId).single();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const { data: brain } = await supabase.from("brand_brain").select("brand_brief, caption_tone").eq("client_id", clientId).maybeSingle();

  const chosenModel = model === "gemini" ? MODEL_FAST : MODEL_CHATGPT;

  const caption = await complete({
    system:
      "You are the senior social media copywriter at TBW Advertising. Write ONE ready-to-post caption. Output ONLY the caption text — no options, no quotes, no explanations.",
    messages: [{
      role: "user",
      content: `Write a ${platform || "instagram"} ${contentType || "post"} caption for the brand "${client.name}".

Brand tone: ${brain?.caption_tone || "professional, warm"}
Target audience: ${client.target_audience || "general"}
Products: ${JSON.stringify(client.products || [])}
Brand brief:
${(brain?.brand_brief || "None").slice(0, 2500)}

${brief ? `What this post is about: ${brief}` : "Write something on-brand and engaging for this brand."}

Rules: hook in the first line, 3-6 relevant hashtags at the end, emojis where natural, under 150 words. Output only the caption.`,
    }],
    model: chosenModel,
    maxTokens: 400,
  });

  return NextResponse.json({ success: true, caption: caption.trim(), model: chosenModel });
}
