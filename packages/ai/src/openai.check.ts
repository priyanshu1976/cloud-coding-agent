// Self-check for repairArgs. Run: pnpm --filter @agent/ai exec tsx src/openai.check.ts
import assert from "node:assert";
import { repairArgs } from "./openai";

// Taken from a real Sarvam response that failed with "cat: 'index.html</arg_value>...': No such file".
const leaked = { path: "index.html</arg_value>\n<arg_key>offset</arg_key>\n<arg_value>90</arg_value>\n<arg_key>limit</arg_key>\n<arg_value>20" };
assert.deepEqual(repairArgs(leaked), { path: "index.html", offset: "90", limit: "20" });
assert.deepEqual(repairArgs({ path: "a.txt", n: 1 }), { path: "a.txt", n: 1 }, "normal args untouched");
console.log("openai checks passed");
