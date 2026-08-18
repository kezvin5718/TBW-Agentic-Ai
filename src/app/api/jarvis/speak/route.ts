import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { synthesizeSpeech } from "@/lib/integrations/stt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/jarvis/speak   { text }
 *
 * Bron's reply as audio, via OpenAI TTS. The browser's built-in speechSynthesis
 * remains the client-side fallback whenever this returns anything but audio, so
 * a missing key degrades to the robotic voice rather than to silence.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  // Bron is founder-only everywhere else; his voice is too.
  if (!user || role !== "founder") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 503 });
  }

  const { text } = await request.json();
  const clean = String(text || "")
    // Markdown symbols and emoji read out loud as garbage.
    .replace(/[*#`_~\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    // tts-1 caps input at 4096 chars; Bron's replies are short, but cap anyway.
    .slice(0, 1500);
  if (!clean) return NextResponse.json({ error: "Nothing to say" }, { status: 400 });

  const audio = await synthesizeSpeech(clean);
  if (!audio || audio.length === 0) {
    return NextResponse.json({ error: "Synthesis failed" }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(audio), {
    headers: { "Content-Type": "audio/aac", "Cache-Control": "no-store" },
  });
}
