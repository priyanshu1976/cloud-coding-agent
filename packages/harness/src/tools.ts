// The tools the model can use, and the code that runs them in the sandbox.
import type { ToolCall, ToolDef } from "@agent/ai";
import type { Sandbox } from "@agent/sandbox";
import { PREVIEW_PORT, type AgentEvent } from "@agent/shared";

export const tools: ToolDef[] = [
  {
    name: "run_command",
    description: "Run a bash command in the repo root and return its output and exit code.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file. The path is relative to the repo root. Optionally read only `limit` lines starting at line `offset` (1-based).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. The path is relative to the repo root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing one exact occurrence of old_string with new_string. Fails if old_string is missing or appears more than once, so include enough context to be unique.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "start_preview",
    description:
      `Start a web server in the background so the user can preview the app in their browser. ` +
      `The command must listen on 0.0.0.0 port ${PREVIEW_PORT} (for example "npm run dev -- --host 0.0.0.0 --port ${PREVIEW_PORT}" ` +
      `or "npx --yes serve -l ${PREVIEW_PORT} ."). Install dependencies first with run_command. ` +
      "Returns once the server answers, or the server's log if it never does.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`; // safe to paste into a shell command
/** Tell the model where its old_string went wrong, so the retry can succeed instead of guessing again. */
function notFoundHint(text: string, old: string, path: string): string {
  const wanted = old.split("\n");
  const first = wanted.find((l) => l.trim())?.trim();
  const lines = text.split("\n");
  const at = first ? lines.findIndex((l) => l.trim() === first) : -1;
  if (at < 0) {
    return `Error: old_string not found in ${path}, and its first line is not in the file. Use read_file to see the current contents.`;
  }
  return (
    `Error: old_string not found in ${path}. Its first line matches line ${at + 1}, where the file actually reads (whitespace exact):\n` +
    `${lines.slice(at, at + wanted.length).join("\n")}\nCopy the text exactly, including indentation.`
  );
}

const MAX_OUTPUT = 10_000; // characters sent back to the model

// Keep the start and the end: errors usually show up at the end of command output.
function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const half = MAX_OUTPUT / 2;
  return `${text.slice(0, half)}\n...[truncated]...\n${text.slice(-half)}`;
}

/** Run one tool call. Errors become text, so the model can see them and try again. */
export async function runTool(
  call: ToolCall,
  sandbox: Sandbox,
  emit: (e: AgentEvent) => void,
): Promise<string> {
  // ponytail: trusts the model to follow the schema; a missing field just becomes an error string
  const input = call.input as Record<string, string>;
  try {
    return truncate(await dispatch());
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  async function dispatch(): Promise<string> {
    switch (call.name) {
      case "run_command": {
        const r = await sandbox.exec(input.command, {
          onOutput: (chunk) => emit({ type: "terminal.output", chunk }),
        });
        return `${r.stdout}${r.stderr}\n[exit code ${r.exitCode}]`;
      }
      case "read_file": {
        const text = await sandbox.readFile(input.path);
        if (!input.offset && !input.limit) return text;
        const lines = text.split("\n");
        const start = Math.max(Number(input.offset) || 1, 1) - 1;
        return lines.slice(start, start + (Number(input.limit) || lines.length)).join("\n");
      }
      case "write_file":
        await sandbox.writeFile(input.path, input.content);
        emit({ type: "file.changed", path: input.path });
        return `Wrote ${input.path}`;
      case "edit_file": {
        const text = await sandbox.readFile(input.path);
        const n = input.old_string ? text.split(input.old_string).length - 1 : 0;
        if (n === 0) return notFoundHint(text, input.old_string ?? "", input.path);
        if (n !== 1) return `Error: old_string found ${n} times in ${input.path}, expected exactly 1`;
        // function replacer: avoids `$&`-style patterns in new_string being interpreted
        await sandbox.writeFile(input.path, text.replace(input.old_string, () => input.new_string));
        emit({ type: "file.changed", path: input.path });
        return `Edited ${input.path}`;
      }
      case "start_preview": {
        // setsid + nohup: the server must outlive this `docker exec`. Its log goes to a file, not to us.
        await sandbox.exec(`setsid nohup bash -c ${quote(input.command)} > /tmp/preview.log 2>&1 < /dev/null &`);
        const wait =
          `for i in $(seq 120); do curl -s -o /dev/null http://127.0.0.1:${PREVIEW_PORT}/ && exit 0; sleep 1; done; ` +
          "tail -n 30 /tmp/preview.log; exit 1";
        const r = await sandbox.exec(wait, { timeoutMs: 130_000 });
        if (r.exitCode !== 0) return `Error: nothing answered on port ${PREVIEW_PORT}. Server log:\n${r.stdout}`;
        emit({ type: "preview.ready" });
        return `Preview is running on port ${PREVIEW_PORT}. The user can open it from the chat.`;
      }
      default:
        return `Unknown tool: ${call.name}`;
    }
  }
}
