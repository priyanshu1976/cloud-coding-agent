import OpenAI from "openai";
import type { LLMClient, Message } from "./types";

// Also used for other OpenAI-compatible APIs (Sarvam), which is why the options exist.
export type OpenAIOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
};

export function openaiClient(apiKey: string, model: string, opts: OpenAIOptions = {}): LLMClient {
  const client = new OpenAI({ apiKey, baseURL: opts.baseURL, defaultHeaders: opts.headers });

  return {
    async chat(messages, tools) {
      const res = await client.chat.completions.create({
        model,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        messages: messages.flatMap(toOpenAI),
        tools: tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      });

      const msg = res.choices[0].message;
      const toolCalls = (msg.tool_calls ?? []).flatMap((c) =>
        c.type === "function"
          ? [{ id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) }]
          : [],
      );
      return { text: msg.content ?? undefined, toolCalls };
    },
  };
}

// One of our messages can become several OpenAI messages (one per tool result).
function toOpenAI(m: Message): OpenAI.ChatCompletionMessageParam[] {
  if (m.role === "user") return [{ role: "user", content: m.content }];

  if (m.role === "assistant") {
    const toolCalls = m.toolCalls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.input) },
    }));
    return [
      {
        role: "assistant",
        content: m.text ?? null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }

  return m.results.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.toolCallId,
    content: r.output,
  }));
}
