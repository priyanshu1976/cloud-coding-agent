// The agent loop: ask the model, run its tool calls in the sandbox, repeat.
// It reports progress through `emit` and knows nothing about HTTP or SSE.
import type { LLMClient, Message } from "@agent/ai";
import type { Sandbox } from "@agent/sandbox";
import type { AgentEvent } from "@agent/shared";
import { runTool, tools } from "./tools";

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`; // safe to paste into a shell command

async function workspaceIsEmpty(sandbox: Sandbox) {
  const r = await sandbox.exec("find . -path ./.git -prune -o -type f -print -quit");
  return r.stdout.trim() === "";
}

export async function runAgent(opts: {
  repoUrl?: string; // no repoUrl = start a new project in an empty repo
  history?: Message[]; // continuing a chat: the workspace is already restored, so skip clone/init
  task: string;
  llm: LLMClient;
  sandbox: Sandbox;
  emit: (e: AgentEvent) => void;
  maxSteps?: number;
  signal?: AbortSignal;
}): Promise<{ summary: string; diff: string; messages: Message[] }> {
  const { repoUrl, history, task, llm, sandbox, emit, maxSteps = 30, signal } = opts;

  signal?.throwIfAborted();
  if (history) {
    // continuing a chat: the files are already in place
  } else if (repoUrl) {
    const clone = await sandbox.exec(`git clone --depth 1 -- ${quote(repoUrl)} .`, {
      timeoutMs: 300_000,
    });
    if (clone.exitCode !== 0) throw new Error(`git clone failed: ${clone.stderr.trim()}`);
    const files = await sandbox.exec("git ls-files | wc -l");
    emit({ type: "clone.done", fileCount: Number(files.stdout) });
  } else {
    // An empty repo, so we can still produce a diff of everything the agent creates.
    const init = await sandbox.exec("git init -q");
    if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
  }

  const where = repoUrl
    ? "A git repo is checked out in your current directory."
    : "Your current directory is an empty git repo. Create the project from scratch here.";
  const messages: Message[] = history
    ? [...history, { role: "user", content: `Task: ${task}` }]
    : [
        {
          role: "user",
          content:
            `You are a coding agent. ${where}\n` +
            "Use the tools to complete the task. When you are done, reply with a short summary and no tool calls.\n" +
            "Files are saved between chats, but node_modules is not: reinstall dependencies if you need them.\n" +
            "If the task builds something with a web front end (plain HTML or a React/Vite app), finish by calling start_preview so the user can see it.\n\n" +
            `Task: ${task}`,
        },
      ];

  let nudged = false;
  let summary = "Stopped: reached the maximum number of steps.";
  
  
  for (let step = 0; step < maxSteps; step++) {
    signal?.throwIfAborted();
    const reply = await llm.chat(messages, tools);
    if (reply.text) emit({ type: "agent.message", text: reply.text });
    messages.push({ role: "assistant", text: reply.text, toolCalls: reply.toolCalls });

    if (reply.toolCalls.length === 0) {
      // Some models announce a plan ("I'll create the files…") and stop. If nothing exists yet, push once.
      if (!nudged && (await workspaceIsEmpty(sandbox))) {
        nudged = true;
        messages.push({ role: "user", content: "You have not created any files yet. Use the tools to do the task now instead of only describing it." });
        continue;
      }
      summary = reply.text ?? "Done.";
      break;
    }

    const results = [];
    for (const call of reply.toolCalls) {
      emit({ type: "tool.call", name: call.name, input: call.input });
      const output = await runTool(call, sandbox, emit);
      emit({ type: "tool.result", name: call.name, output });
      results.push({ toolCallId: call.id, name: call.name, output });
    }
    messages.push({ role: "tool", results });
  }

  // `git add -A` first so new files show up in the diff too.
  const diff = await sandbox.exec("git add -A && git diff --cached");
  return { summary, diff: diff.stdout, messages };
}
