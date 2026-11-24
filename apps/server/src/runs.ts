// A "run" is one agent task: its event log, who is listening, and its result zip.
// A chat is a series of runs. Its history is in Neon and its files are in R2 (see @agent/db and @agent/cloud).
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLLM, type Message } from "@agent/ai";
import { restoreWorkspace, saveWorkspace } from "@agent/cloud";
import { createChat, saveChat, type Chat } from "@agent/db";
import { runAgent } from "@agent/harness";
import { createSandbox, type Sandbox } from "@agent/sandbox";
import { PREVIEW_PORT, type AgentEvent, type CreateRunRequest } from "@agent/shared";
import { hasPreview, openPreview, stopPreview } from "./preview";

export type Run = {
  events: AgentEvent[]; // the full log; a reconnecting browser replays from here
  listeners: Set<(eventIndex: number) => void>; // open SSE connections
  controller: AbortController;
  chatId: string;
  sandbox?: Sandbox;
  zipPath?: string; // set once the run succeeds
};

// ponytail: in memory and never cleaned up. Add expiry (and delete the zips) if the server runs for days.
export const runs = new Map<string, Run>();

/** `chat` is the existing chat to continue, or undefined to start a new one. */
export async function startRun(req: CreateRunRequest, chat?: Chat) {
  const runId = randomUUID();
  const chatId = chat?.id ?? randomUUID();
  if (!chat) await createChat(chatId, req.task.slice(0, 60));

  const run: Run = { events: [], listeners: new Set(), controller: new AbortController(), chatId };
  stopPreview(chatId); // the old sandbox is replaced by the one this run restores into
  runs.set(runId, run);
  void execute(runId, chatId, chat, run, req); // not awaited: the browser follows along over SSE
  return { runId, chatId };
}

export function cancelRun(run: Run) {
  run.controller.abort();
  stopPreview(run.chatId);
  void run.sandbox?.destroy(); // kills whatever command is running right now
}

// ponytail: two runs in the same chat at once would overwrite each other. The UI only allows one at a time.
async function execute(id: string, chatId: string, chat: Chat | undefined, run: Run, req: CreateRunRequest) {
  const emit = (event: AgentEvent) => {
    run.events.push(event);
    run.listeners.forEach((send) => send(run.events.length - 1));
    // The agent's dev server is up: give it a public link. The sandbox then outlives the run (see `finally`).
    if (event.type === "preview.ready" && run.sandbox) {
      const sandbox = run.sandbox;
      previewing = openPreview(chatId, sandbox).then(
        (url) => emit({ type: "preview.url", url }),
        (err) => emit({ type: "agent.message", text: `Preview unavailable: ${err.message}` }),
      );
    }
  };
  let previewing: Promise<void> | undefined;

  let messages: Message[] | undefined; // the model's history, saved only if the run succeeds

  try {
    emit({ type: "run.started", runId: id });
    emit({ type: "user.message", text: req.task, repoUrl: chat ? undefined : req.repoUrl });
    run.sandbox = await createSandbox({ image: "cloud-agent-sandbox", publishPort: PREVIEW_PORT });
    emit({ type: "sandbox.ready" });

    // Continuing a chat: put its files back first.
    const restored = chat ? await restoreWorkspace(chatId, run.sandbox) : false;
    if (restored) emit({ type: "workspace.restored" });

    const result = await runAgent({
      repoUrl: req.repoUrl,
      history: restored ? chat!.messages : undefined,
      task: req.task,
      llm: createLLM({ provider: req.provider, apiKey: req.apiKey, model: req.model }),
      sandbox: run.sandbox,
      emit,
      signal: run.controller.signal,
    });

    // Zip the repo (without .git and node_modules) and copy it out for the download button.
    const zip = await run.sandbox.exec("zip -r /tmp/result.zip . -x '.git/*' '*node_modules/*'");
    if (zip.exitCode === 12) throw new Error("The agent finished without creating any files. Try again, or describe the task in more detail."); // zip's "nothing to do"
    if (zip.exitCode !== 0) throw new Error(`zip failed: ${zip.stderr.trim()}`);
    const zipPath = join(tmpdir(), `${id}.zip`);
    await run.sandbox.download("/tmp/result.zip", zipPath);
    run.zipPath = zipPath;

    await saveWorkspace(chatId, run.sandbox); // so the next message in this chat can continue from here
    messages = result.messages;
    emit({ type: "run.completed", summary: result.summary, diff: result.diff });
  } catch (err) {
    const error = run.controller.signal.aborted
      ? "Cancelled"
      : err instanceof Error
        ? err.message
        : String(err);
    emit({ type: "run.failed", error });
  } finally {
    // Save before destroying: destroy takes a second, and the user may send the next message right away.
    await saveChat(chatId, run.events, messages).catch((err) => console.error("could not save chat", err));
    await previewing;
    // A live preview owns the sandbox now; it destroys it when it stops.
    if (!run.sandbox || !hasPreview(chatId, run.sandbox)) await run.sandbox?.destroy();
  }
}
