// Self-check for read_file offset/limit and the edit_file "not found" hint. Run: pnpm --filter @agent/harness exec tsx src/tools.check.ts
import assert from "node:assert";
import type { Sandbox } from "@agent/sandbox";
import { runTool } from "./tools";

const file = "<html>\n  <body>\n    <p>hi</p>\n  </body>\n</html>";
const sandbox = { readFile: async () => file, writeFile: async () => {} } as unknown as Sandbox;
const run = (name: string, input: Record<string, unknown>) => runTool({ id: "1", name, input }, sandbox, () => {});

assert.equal(await run("read_file", { path: "a.html", offset: 2, limit: 2 }), "  <body>\n    <p>hi</p>");
assert.equal(await run("read_file", { path: "a.html" }), file);

// Wrong indentation: the error points at the real line instead of just saying "0 times".
const hint = await run("edit_file", { path: "a.html", old_string: "<p>hi</p>\n</body>", new_string: "<p>yo</p>" });
assert.match(hint, /^Error: old_string not found/);
const wrongIndent = await run("edit_file", { path: "a.html", old_string: "<body>\n<p>hi</p>", new_string: "x" });
assert.match(wrongIndent, /line 2, where the file actually reads[^]*  <body>\n    <p>hi<\/p>/);
assert.match(await run("edit_file", { path: "a.html", old_string: "nope", new_string: "x" }), /first line is not in the file/);
assert.equal(await run("edit_file", { path: "a.html", old_string: "    <p>hi</p>", new_string: "    <p>yo</p>" }), "Edited a.html");
console.log("tools checks passed");
