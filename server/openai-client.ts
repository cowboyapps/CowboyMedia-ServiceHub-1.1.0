import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY || !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    return null;
  }
  if (!cached) {
    cached = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return cached;
}
