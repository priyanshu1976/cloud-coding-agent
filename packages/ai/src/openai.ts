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
          ? [{ id: c.id, name: c.function.name, input: repairArgs(JSON.parse(c.function.arguments)) }]
          : [],
      );
      return { text: msg.content?.trim() ? msg.content : undefined, toolCalls };
    },
  };
}

// Some models (GLM, behind Sarvam) leak their XML tool format into an argument, e.g. path =
// "index.html</arg_value><arg_key>offset</arg_key><arg_value>90". Split that back into real arguments.
export function repairArgs(input: Record<string, unknown>) {
  const out = { ...input };
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || !value.includes("</arg_value>")) continue;
    out[key] = value.slice(0, value.indexOf("</arg_value>"));
    for (const m of value.matchAll(/<arg_key>(\w+)<\/arg_key>\s*<arg_value>([\s\S]*?)(?:<\/arg_value>|$)/g)) out[m[1]] = m[2];
  }
  return out;
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
