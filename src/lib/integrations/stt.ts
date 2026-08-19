/**
 * Speech-to-Text (STT) and Text-to-Speech (TTS) Integration Services
 * Uses OpenAI Whisper and TTS APIs, configurable via environment.
 */

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not configured. Returning simulated mock transcription.");
    return "Show me overdue tasks";
  }

  try {
    let ext = "ogg";
    if (mimeType.includes("aac")) ext = "aac";
    else if (mimeType.includes("wav")) ext = "wav";
    else if (mimeType.includes("mp3")) ext = "mp3";
    else if (mimeType.includes("m4a")) ext = "m4a";

    const formData = new FormData();
    const file = new File([new Uint8Array(audioBuffer)], `audio.${ext}`, { type: mimeType });
    
    formData.append("file", file);
    formData.append("model", "whisper-1");
    // Instruct Whisper to recognize Indian English with Hindi/Gujarati code-mixing terms
    formData.append(
      "prompt",
      "Indian English with Hindi/Gujarati code-mixing (Hinglish, Gujaralish), using brand names and food terms like Swad, pickles, spices, masala, Dal Makhani, achaar."
    );

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Whisper transcription failed:", errorText);
      throw new Error(`OpenAI STT Error: ${response.statusText} (${errorText})`);
    }

    const data = await response.json();
    return data.text || "";
  } catch (error: unknown) {
    console.error("Error in transcribeAudio service:", error);
    throw error;
  }
}

/**
 * How Bron should sound when OpenAI is doing the talking.
 *
 * tts-1 reads text flatly and cannot be directed. The steerable model can:
 * this instruction is what turns a generic narrator into a composed British
 * assistant, and it costs the same as the flat one. Overridable, because the
 * right register is a matter of taste and shouldn't need a deploy to change.
 */
const BRON_VOICE_STYLE =
  process.env.TTS_INSTRUCTIONS ||
  "Speak as a composed, highly capable British AI assistant addressing the person you work for. Received Pronunciation, warm but understated, never theatrical. Measured pace, precise consonants, a slight downward inflection at the end of statements. Deliver facts with quiet confidence — you are reporting, not performing.";

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not configured. Skipping speech synthesis.");
    return Buffer.alloc(0);
  }

  try {
    // "ash" is the deep, even-toned one; the steerable model takes the accent
    // and delivery from the instructions above rather than from the voice name.
    const voice = process.env.WHATSAPP_TTS_VOICE || "ash";
    const model = process.env.TTS_MODEL || "gpt-4o-mini-tts";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: voice,
        response_format: "aac", // Meta WhatsApp accepts AAC natively
        // Only the steerable models accept direction; older ones reject it.
        ...(model.startsWith("gpt-4o") ? { instructions: BRON_VOICE_STYLE } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TTS synthesis failed:", errorText);
      // An account without the steerable model would otherwise lose speech
      // entirely; retry once on the model every key can use.
      if (model !== "tts-1") {
        const retry = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "tts-1", input: text, voice: "onyx", response_format: "aac" }),
        });
        if (retry.ok) return Buffer.from(await retry.arrayBuffer());
      }
      throw new Error(`OpenAI TTS Error: ${response.statusText} (${errorText})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error: unknown) {
    console.error("Error in synthesizeSpeech service:", error);
    throw error;
  }
}
