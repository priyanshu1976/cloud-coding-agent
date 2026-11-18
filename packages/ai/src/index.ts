import type { Provider } from "@agent/shared";
import { anthropicClient } from "./anthropic";
import { geminiClient } from "./gemini";
import { openaiClient } from "./openai";
import type { LLMClient } from "./types";

export * from "./types";

const clients: Record<Provider, (apiKey: string, model: string) => LLMClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  gemini: geminiClient,
  // Sarvam speaks the OpenAI protocol. Their docs disagree on the auth header, so send both
  // (the SDK already sends Authorization: Bearer). Reasoning tokens count toward max_tokens, so set it high.
  sarvam: (apiKey, model) =>
    openaiClient(apiKey, model, {
      baseURL: "https://api.sarvam.ai/v2",
      headers: { "api-subscription-key": apiKey },
      maxTokens: 8192,
    }),
};

export function createLLM(opts: { provider: Provider; apiKey: string; model: string }): LLMClient {
  return clients[opts.provider](opts.apiKey, opts.model);
}
