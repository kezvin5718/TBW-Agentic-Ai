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
