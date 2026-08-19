import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { synthesizeSpeech } from "@/lib/integrations/stt";
import { speakWithElevenLabs, isElevenLabsConfigured, listElevenLabsVoices } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireFounder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.user_metadata?.role as string) || "client";
  // Bron is founder-only everywhere else; his voice is too.
  if (!user || role !== "founder") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** GET — the voices available to choose from, for picking one without a deploy. */
export async function GET() {
  const denied = await requireFounder();
  if (denied) return denied;
  return NextResponse.json({
    success: true,
    provider: isElevenLabsConfigured() ? "elevenlabs" : process.env.OPENAI_API_KEY ? "openai" : "none",
    current: process.env.ELEVENLABS_VOICE_ID || "onwK4e9ZLuTAKqWW03F9 (Daniel, default)",
    voices: await listElevenLabsVoices(),
  });
}

/**
 * POST /api/jarvis/speak   { text }
 *
 * Bron's reply as audio. ElevenLabs when it is configured — that is the voice
 * worth listening to — and OpenAI's tts-1 behind it, so a missing or exhausted
 * key degrades to a plainer voice rather than to silence. The browser's own
 * speechSynthesis remains the last resort on the client.
 */
export async function POST(request: NextRequest) {
  const denied = await requireFounder();
  if (denied) return denied;

  if (!isElevenLabsConfigured() && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "No speech provider configured" }, { status: 503 });
  }

  const { text } = await request.json();
  const clean = String(text || "")
    // Markdown symbols and emoji read out loud as garbage.
    .replace(/[*#`_~\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
  if (!clean) return NextResponse.json({ error: "Nothing to say" }, { status: 400 });

  // First choice.
  const { audio, error } = await speakWithElevenLabs(clean);
  if (audio) {
    return new NextResponse(new Uint8Array(audio.buffer), {
      headers: {
        "Content-Type": audio.mime,
        "Cache-Control": "no-store",
        "X-Voice-Provider": "elevenlabs",
      },
    });
  }

  // Fallback. Carry the reason in a header so a silent downgrade is still
  // visible to anyone looking at the network tab.
  const fallback = await synthesizeSpeech(clean);
  if (!fallback || fallback.length === 0) {
    return NextResponse.json({ error: error || "Synthesis failed" }, { status: 502 });
  }
  return new NextResponse(new Uint8Array(fallback), {
    headers: {
      "Content-Type": "audio/aac",
      "Cache-Control": "no-store",
      "X-Voice-Provider": "openai",
      "X-Voice-Fallback-Reason": (error || "elevenlabs unavailable").slice(0, 120),
    },
  });
}
