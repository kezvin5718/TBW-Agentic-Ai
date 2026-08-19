/**
 * Bron's voice.
 *
 * OpenAI's tts-1 reads text correctly and sounds like a machine reading text.
 * ElevenLabs is what makes an assistant sound like a person who happens to be
 * an assistant — which is the whole point of a voice you talk to every day.
 *
 * The default voice is a deep, measured British one, because that is the
 * register the founder asked for. Both the voice and the model are environment
 * variables: changing Bron's voice should never need a deploy of new code.
 */

const API = "https://api.elevenlabs.io/v1/text-to-speech";

/** Daniel — deep, calm, British. The closest public voice to the one asked for. */
const DEFAULT_VOICE = "onwK4e9ZLuTAKqWW03F9";
/** Turbo keeps the reply quick; the multilingual model is the quality option. */
const DEFAULT_MODEL = "eleven_turbo_v2_5";

const TIMEOUT_MS = 30_000;

export function isElevenLabsConfigured(): boolean {
  const key = process.env.ELEVENLABS_API_KEY;
  return !!key && key !== "mock" && !key.startsWith("mock_");
}

export interface SpokenAudio {
  buffer: Buffer;
  mime: string;
  provider: "elevenlabs";
}

/**
 * Speak `text`. Returns null — never throws — when ElevenLabs is unconfigured
 * or unhappy, so the caller can fall back rather than leaving Bron mute.
 */
export async function speakWithElevenLabs(text: string): Promise<{ audio: SpokenAudio | null; error?: string }> {
  if (!isElevenLabsConfigured()) return { audio: null, error: "ELEVENLABS_API_KEY not set" };

  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;

  try {
    const res = await fetch(`${API}/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          // Steady rather than theatrical: an assistant reporting facts.
          stability: 0.45,
          similarity_boost: 0.85,
          // A little character, not a performance.
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      // 401 = bad key, 404 = the voice id doesn't exist on this account,
      // 429 = out of characters. All are worth reading in the log rather than
      // silently degrading to the robotic voice with no explanation.
      console.error(`ElevenLabs ${res.status}: ${body}`);
      return { audio: null, error: `ElevenLabs ${res.status}: ${body}` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return { audio: null, error: "ElevenLabs returned no audio" };
    return { audio: { buffer, mime: "audio/mpeg", provider: "elevenlabs" } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ElevenLabs synthesis failed:", msg);
    return { audio: null, error: msg };
  }
}

/** The voices on the account, so the founder can pick one without a deploy. */
export async function listElevenLabsVoices(): Promise<{ voice_id: string; name: string; labels?: Record<string, string> }[]> {
  if (!isElevenLabsConfigured()) return [];
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY as string },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, labels: v.labels }));
  } catch {
    return [];
  }
}
