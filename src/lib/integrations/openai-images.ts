/**
 * Ceilings on how long a provider may take before the call is abandoned.
 *
 * There were none. A plan batch renders every frame in sequence inside a single
 * 600-second route budget, so one stalled request took the whole run down with
 * it and the screen simply sat there spinning. Generation is genuinely slow, so
 * the limit is generous; describing an image is not, so it is tighter.
 */
const IMAGE_TIMEOUT_MS = 120_000;
const VISION_TIMEOUT_MS = 45_000;

export interface OpenAIImageGenerationOptions {
  model?: string;
  ratio?: string;
  productImageUrl?: string | null;
}

export interface OpenAIImageResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Configurable constants
const OPENAI_IMAGE_CONFIG = {
  defaultModel: "dall-e-3",
  costPerImage: 2.0, // cost in credits mapped to gen_costs
};

/**
 * Direct Vision describer helper using OpenAI or OpenRouter.
 * Avoids type safety errors and handles multimodal payloads properly.
 */
export async function describeImageViaVision(imageUrl: string, instruction: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "mock" || apiKey.startsWith("mock_")) {
    return "";
  }

  const endpoint = process.env.OPENAI_API_KEY
    ? "https://api.openai.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";

  const model = process.env.OPENAI_API_KEY ? "gpt-4o" : "google/gemini-2.5-flash";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      // A batch renders frames one after another inside a 600s route budget, so
      // one provider stall used to swallow the whole run and every later frame
      // with it. Failing this call fast costs one description; hanging costs
      // the batch.
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 150
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("[OpenAI Vision] API call failed:", err);
    return "";
  }
}

/**
 * Generates a background image and returns the raw bytes.
 *
 * The model matters for one specific reason: it must render text inside an
 * image reliably, since the posts this is used for — festival greetings, offer
 * cards — are mostly type, often in Devanagari as well as Latin. Every option
 * answers with base64 in data[0].b64_json, so there is nothing to download.
 *
 * Only ever used for creatives with no real product in them. A photograph of a
 * client's jewellery is composited, never regenerated.
 */
/** The model a generation will actually use, resolvable without calling it. */
export function imageModelName(): string {
  const viaRouter = !!process.env.OPENROUTER_API_KEY;
  return process.env.IMAGE_MODEL || (viaRouter ? "openai/gpt-5.4-image-2" : "gpt-image-1");
}

export async function generateBrandImage(
  prompt: string,
  shape: "square" | "portrait" | "landscape" = "square"
): Promise<{ buffer: Buffer | null; error?: string }> {
  const viaRouter = !!process.env.OPENROUTER_API_KEY;
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { buffer: null, error: "Neither OPENROUTER_API_KEY nor OPENAI_API_KEY is set on the server." };
  }

  // Image models are retired and replaced faster than anything else here —
  // gpt-image-1 was current when this was written and has already gone from
  // OpenRouter's catalogue. Settable from the environment so a swap is a
  // config change and a restart, not an edit and a deploy.
  const model = process.env.IMAGE_MODEL || (viaRouter ? "openai/gpt-5.4-image-2" : "gpt-image-1");

  // OpenRouter reaches the same model through its own image endpoint, which
  // takes an aspect ratio; OpenAI's takes explicit pixels. Both answer with
  // base64 in data[0].b64_json.
  const endpoint = viaRouter ? "https://openrouter.ai/api/v1/images" : "https://api.openai.com/v1/images/generations";
  const body = viaRouter
    ? {
        model,
        prompt,
        n: 1,
        aspect_ratio: shape === "portrait" ? "9:16" : shape === "landscape" ? "16:9" : "1:1",
        quality: "high",
        output_format: "png",
      }
    : {
        model,
        prompt,
        n: 1,
        size: shape === "portrait" ? "1024x1536" : shape === "landscape" ? "1536x1024" : "1024x1024",
        quality: "high",
      };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const raw = data.error?.message || `Image generation failed (${res.status})`;
      // A retired or misspelled model is the likeliest cause and reads as an
      // opaque 400, so name the setting that fixes it.
      if (/model/i.test(raw) && /(not found|invalid|unknown|no endpoints)/i.test(raw)) {
        return {
          buffer: null,
          error: `The image model "${model}" was rejected: ${raw}. Set IMAGE_MODEL in the server .env to a current one — openai/gpt-5-image, openai/gpt-5-image-mini, openai/gpt-5.4-image-2 or google/gemini-3-pro-image.`,
        };
      }
      return { buffer: null, error: raw };
    }

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return { buffer: null, error: `No image came back from ${viaRouter ? "OpenRouter" : "OpenAI"}.` };
    return { buffer: Buffer.from(b64, "base64") };
  } catch (err: unknown) {
    return { buffer: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Whether anything can generate an image at all. */
export function isImageGenerationConfigured(): boolean {
  return !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Generates an image using OpenAI's DALL-E 3 API.
 * If a productImageUrl is provided, it first uses describeImageViaVision to get a detailed
 * visual description of the product and appends it to the prompt.
 */
export async function generateOpenAIImage(
  promptText: string,
  options: OpenAIImageGenerationOptions = {}
): Promise<OpenAIImageResult> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: "OpenAI API Key is not configured." };
    }

    const model = options.model || OPENAI_IMAGE_CONFIG.defaultModel;
    const ratio = options.ratio || "9:16";

    // Map aspect ratios to DALL-E 3 supported dimensions
    let size = "1024x1024";
    if (ratio === "9:16" || ratio === "3:4") {
      size = "1024x1792";
    } else if (ratio === "16:9" || ratio === "4:3") {
      size = "1792x1024";
    }

    let finalPrompt = promptText;

    // If product image is provided, run Vision helper to describe the product
    if (options.productImageUrl) {
      try {
        console.log(`[OpenAI Images] Analyzing product image with Vision: ${options.productImageUrl}`);
        const instruction = "You are a precise cataloguer. Describe the main product (e.g. jewellery, food item, product container) in the image with extreme visual detail (material, texture, shapes, colors, craftsmanship). Be concise and describe it in under 60 words so it can be reconstructed by an DALL-E. Avoid generic text.";
        const productDescription = await describeImageViaVision(options.productImageUrl, instruction);

        if (productDescription && productDescription.trim()) {
          console.log(`[OpenAI Images] Product Description Extracted: "${productDescription.trim()}"`);
          finalPrompt = `${finalPrompt}\n\n[PRODUCT DETAILS TO RENDER: The creative must prominently feature a product matching this description: ${productDescription.trim()}. Place it naturally in the scene as the central focus.]`;
        }
      } catch (visionErr) {
        console.error("[OpenAI Images] Vision description failed, proceeding with raw prompt:", visionErr);
      }
    }

    console.log(`[OpenAI Images] Calling DALL-E 3 with size ${size}. Composed Prompt: "${finalPrompt}"`);

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        prompt: finalPrompt,
        n: 1,
        size: size,
        response_format: "url",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[OpenAI Images] API Error:", data);
      return {
        success: false,
        error: data.error?.message || "Failed to generate image via OpenAI",
      };
    }

    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) {
      return { success: false, error: "No image URL returned from OpenAI" };
    }

    return {
      success: true,
      url: imageUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[OpenAI Images] Exception:", err);
    return {
      success: false,
      error: msg,
    };
  }
}

export { OPENAI_IMAGE_CONFIG };
