// Self-check for the "announced a plan and stopped" nudge. Run: pnpm --filter @agent/harness exec tsx src/agent.check.ts
import assert from "node:assert";
import type { LLMClient } from "@agent/ai";
import type { Sandbox } from "@agent/sandbox";
import { runAgent } from "./index";

function run(filesExist: boolean) {
  let calls = 0;
  const llm: LLMClient = { chat: async () => (calls++, { text: "I'll create the files.", toolCalls: [] }) };
  const sandbox = {
    exec: async (cmd: string) => ({ stdout: cmd.startsWith("find") && filesExist ? "./a.txt\n" : "", stderr: "", exitCode: 0 }),
  } as unknown as Sandbox;
  return runAgent({ task: "build it", llm, sandbox, emit: () => {} }).then((r) => ({ calls, r }));
}

const empty = await run(false);
assert.equal(empty.calls, 2, "empty workspace: nudged once, then accepted");
assert.ok(empty.r.messages.some((m) => m.role === "user" && m.content.includes("not created any files")));

assert.equal((await run(true)).calls, 1, "files exist (e.g. a question about the project): no nudge");
console.log("agent checks passed");
