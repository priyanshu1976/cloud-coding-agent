import { GoogleGenAI, type Content } from "@google/genai";
import type { LLMClient, Message } from "./types";

export function geminiClient(apiKey: string, model: string): LLMClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async chat(messages, tools) {
      const res = await ai.models.generateContent({
        model,
        contents: messages.map(toGemini),
        config: {
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters,
              })),
            },
          ],
        },
      });

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const text = parts.flatMap((p) => (p.text && !p.thought ? [p.text] : [])).join("\n");
      const toolCalls = parts.flatMap((p, i) =>
        p.functionCall
          ? [
              {
                id: p.functionCall.id ?? `call_${i}`,
                name: p.functionCall.name ?? "",
                input: p.functionCall.args ?? {},
                signature: p.thoughtSignature,
              },
            ]
          : [],
      );
      return { text: text || undefined, toolCalls };
    },
  };
}

function toGemini(m: Message): Content {
  if (m.role === "user") return { role: "user", parts: [{ text: m.content }] };

  if (m.role === "assistant") {
    return {
      role: "model",
      parts: [
        ...(m.text ? [{ text: m.text }] : []),
        ...m.toolCalls.map((c) => ({
          functionCall: { id: c.id, name: c.name, args: c.input },
          thoughtSignature: c.signature, // Gemini 3+ requires this to be sent back
        })),
      ],
    };
  }

  return {
    role: "user",
    parts: m.results.map((r) => ({
      functionResponse: { id: r.toolCallId, name: r.name, response: { output: r.output } },
    })),
  };
}
