// Smoke test: real sandbox, fake LLM. Needs Docker and the image (pnpm sandbox:build). No API key.
//   pnpm --filter @agent/harness check
import assert from "node:assert";
import type { LLMClient } from "@agent/ai";
import { createSandbox } from "@agent/sandbox";
import type { AgentEvent } from "@agent/shared";
import { runAgent } from "./index";

// A fake "model" that writes hello.txt, then says it is done.
function fakeLLM(): LLMClient {
  const script = [
    { toolCalls: [{ id: "1", name: "write_file", input: { path: "hello.txt", content: "hi\n" } }] },
    { text: "All done", toolCalls: [] },
  ];
  return { chat: async () => script.shift()! };
}

// Run one agent with the fake model in a fresh sandbox, with or without a repo.
async function run(repoUrl?: string) {
  const sandbox = await createSandbox({ image: "cloud-agent-sandbox" });
  try {
    const events: AgentEvent[] = [];
    const result = await runAgent({
      repoUrl,
      task: "add hello.txt",
      llm: fakeLLM(),
      sandbox,
      emit: (e) => events.push(e),
    });
    assert.equal(result.summary, "All done");
    assert.match(result.diff, /hello\.txt/);
    assert.ok(events.some((e) => e.type === "file.changed"));
    return events;
  } finally {
    await sandbox.destroy();
  }
}

// Commands must be stopped by the timeout.
const sandbox = await createSandbox({ image: "cloud-agent-sandbox" });
try {
  const timedOut = await sandbox.exec("sleep 10", { timeoutMs: 1000 });
  assert.equal(timedOut.exitCode, 124, "timeout should stop the command");
} finally {
  await sandbox.destroy();
}

const withRepo = await run("https://github.com/octocat/Hello-World");
assert.ok(withRepo.some((e) => e.type === "clone.done"));

const noRepo = await run(); // new project from scratch
assert.ok(!noRepo.some((e) => e.type === "clone.done"));

console.log("ok");
