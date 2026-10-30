export const MODEL_SMART = "anthropic/claude-sonnet-4.6";
export const MODEL_FAST = "google/gemini-2.5-flash";
// ChatGPT (OpenAI) routed via OpenRouter — used by the full-plan generator and plan importer.
export const MODEL_CHATGPT = "openai/gpt-4o";
// The caption pipeline — reading the video and writing the caption — runs on one
// OpenAI model (founder's choice, 30 Oct). It reasons before answering, so its
// callers ask for low effort and leave token room for that thinking.
export const MODEL_CAPTIONS = "openai/gpt-6.1-terra";
export const CAPTIONS_REASONING_EFFORT = "low";
