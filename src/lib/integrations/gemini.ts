import { GoogleGenerativeAI, Schema, GenerationConfig } from "@google/generative-ai";

export interface LLMMessage {
  role: "user" | "assistant" | "model" | "system";
  content: string;
}

export interface GeminiCompleteParams {
  system?: string;
  messages: LLMMessage[];
  jsonSchema?: Schema;
  modelName?: string;
}

// Initialize the Gemini API client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not defined.");
  }
  return new GoogleGenerativeAI(apiKey || "");
};

/**
 * Generic retry wrapper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) {
      console.error("Gemini API call failed: all retries exhausted. Error:", error);
      throw error;
    }
    console.warn(`Gemini API call failed. Retrying in ${delay}ms... (${retries} retries left). Error:`, error);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

/**
 * Complete a chat or request using the Gemini API
 */
export async function geminiComplete({
  system,
  messages,
  jsonSchema,
  modelName = "gemini-1.5-flash",
}: GeminiCompleteParams): Promise<string> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: modelName });

  // Map roles: Gemini expects 'user' and 'model' for chat history
  const contents = messages
    .filter((msg) => msg.role !== "system") // Filter system messages from content history
    .map((msg) => {
      const role = msg.role === "assistant" || msg.role === "model" ? "model" : "user";
      return {
        role,
        parts: [{ text: msg.content }],
      };
    });

  // Extract system prompt if it was passed in the messages array under 'system' role
  const systemMessage = messages.find((msg) => msg.role === "system")?.content;
  const finalSystemInstruction = system || systemMessage;

  const generationConfig: GenerationConfig = {};
  if (jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = jsonSchema;
  }

  return retryWithBackoff(async () => {
    const result = await model.generateContent({
      contents,
      systemInstruction: finalSystemInstruction,
      generationConfig,
    });

    const responseText = result.response.text();
    if (!responseText) {
      throw new Error("Received empty response from Gemini API");
    }
    return responseText;
  });
}
