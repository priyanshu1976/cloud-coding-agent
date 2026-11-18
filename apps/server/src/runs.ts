// A "run" is one agent task: its event log, who is listening, and its result zip.
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLLM } from "@agent/ai";
import { runAgent } from "@agent/harness";
import { createSandbox, type Sandbox } from "@agent/sandbox";
import type { AgentEvent, CreateRunRequest } from "@agent/shared";

export type Run = {
  events: AgentEvent[]; // the full log; a reconnecting browser replays from here
  listeners: Set<(eventIndex: number) => void>; // open SSE connections
  controller: AbortController;
  sandbox?: Sandbox;
  zipPath?: string; // set once the run succeeds
};

// ponytail: in memory and never cleaned up. Add expiry (and delete the zips) if the server runs for days.
export const runs = new Map<string, Run>();

export function startRun(req: CreateRunRequest): string {
  const id = randomUUID();
  const run: Run = { events: [], listeners: new Set(), controller: new AbortController() };
  runs.set(id, run);
  void execute(id, run, req); // not awaited: the browser follows along over SSE
  return id;
}

export function cancelRun(run: Run) {
  run.controller.abort();
  void run.sandbox?.destroy(); // kills whatever command is running right now
}

async function execute(id: string, run: Run, req: CreateRunRequest) {
  const emit = (event: AgentEvent) => {
    run.events.push(event);
    run.listeners.forEach((send) => send(run.events.length - 1));
  };

  try {
    emit({ type: "run.started", runId: id });
    run.sandbox = await createSandbox({ image: "cloud-agent-sandbox" });
    emit({ type: "sandbox.ready" });

    const { summary, diff } = await runAgent({
      repoUrl: req.repoUrl,
      task: req.task,
      llm: createLLM({ provider: req.provider, apiKey: req.apiKey, model: req.model }),
      sandbox: run.sandbox,
      emit,
      signal: run.controller.signal,
    });

    // Zip the repo (without .git and node_modules) and copy it out for the download button.
    await run.sandbox.exec("zip -r /tmp/result.zip . -x '.git/*' '*node_modules/*'");
    const zipPath = join(tmpdir(), `${id}.zip`);
    await run.sandbox.download("/tmp/result.zip", zipPath);
    run.zipPath = zipPath;

    emit({ type: "run.completed", summary, diff });
  } catch (err) {
    const error = run.controller.signal.aborted
      ? "Cancelled"
      : err instanceof Error
        ? err.message
        : String(err);
    emit({ type: "run.failed", error });
  } finally {
    await run.sandbox?.destroy();
  }
}
