// Types (and the MODELS list) shared by the server and the web app.

/** Everything a run reports, in order. The server streams these to the browser as SSE. */
export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "user.message"; text: string; repoUrl?: string }
  | { type: "sandbox.ready" }
  | { type: "workspace.restored" } // the chat's saved files were loaded from R2
  | { type: "clone.done"; fileCount: number }
  | { type: "agent.message"; text: string }
  | { type: "tool.call"; name: string; input: unknown }
  | { type: "tool.result"; name: string; output: string }
  | { type: "terminal.output"; chunk: string }
  | { type: "file.changed"; path: string }
  | { type: "preview.ready" } // the agent's dev server answers on PREVIEW_PORT inside the sandbox
  | { type: "preview.url"; url: string } // where the browser can open it
  | { type: "run.completed"; summary: string; diff: string }
  | { type: "run.failed"; error: string };

/** The port a dev server must listen on (on 0.0.0.0) inside the sandbox to be previewed. */
export const PREVIEW_PORT = 5173;

/** The models you can pick for each provider. The first one is the default. */
export const MODELS = {
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-terra", "gpt-6-luna"],
  gemini: ["gemini-4-hydrogen", "gemini-4-argon", "gemini-4-carbon", "gemini-3.8-flash", "gemini-3.6-flash"],
  sarvam: ["sarvam-105b", "glm5.3", "glm5.3-flash", "gemma4", "deepseekv4.1-flash-1017"],
} as const;

export type Provider = keyof typeof MODELS;
export type Model = (typeof MODELS)[Provider][number];

/** POST /runs */
export type CreateRunRequest = {
  chatId?: string; // continue this chat; leave out to start a new one
  repoUrl?: string; // leave out to start a new project from scratch (ignored when continuing a chat)
  task: string;
  provider: Provider;
  apiKey: string;
  model: Model;
};

export type CreateRunResponse = { runId: string; chatId: string };

/** One row of the chat list. */
export type ChatSummary = { id: string; title: string };
