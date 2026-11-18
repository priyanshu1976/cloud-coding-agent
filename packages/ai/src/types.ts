// One message format for every provider. anthropic.ts and openai.ts translate it.

/** A tool the model may call. `parameters` is a JSON Schema object. */
export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Opaque data a provider wants echoed back unchanged (Gemini's thought signature). */
  signature?: string;
};

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; text?: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: { toolCallId: string; name: string; output: string }[] };

/** The model is finished when it replies with no tool calls. */
export type LLMReply = { text?: string; toolCalls: ToolCall[] };

export interface LLMClient {
  chat(messages: Message[], tools: ToolDef[]): Promise<LLMReply>;
}
