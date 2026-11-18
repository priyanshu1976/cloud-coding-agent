import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message } from "./types";

export function anthropicClient(apiKey: string, model: string): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    async chat(messages, tools) {
      const res = await client.messages.create({
        model,
        max_tokens: 8192,
        messages: messages.map(toAnthropic),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      });

      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      const toolCalls = res.content.flatMap((b) =>
        b.type === "tool_use"
          ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }]
          : [],
      );
      return { text: text || undefined, toolCalls };
    },
  };
}

function toAnthropic(m: Message): Anthropic.MessageParam {
  if (m.role === "user") return { role: "user", content: m.content };

  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: [
        ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
        ...m.toolCalls.map((c) => ({
          type: "tool_use" as const,
          id: c.id,
          name: c.name,
          input: c.input,
        })),
      ],
    };
  }

  // Anthropic wants all tool results in a single user message.
  return {
    role: "user",
    content: m.results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolCallId,
      content: r.output,
    })),
  };
}
