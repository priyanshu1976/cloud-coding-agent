// The tools the model can use, and the code that runs them in the sandbox.
import type { ToolCall, ToolDef } from "@agent/ai";
import type { Sandbox } from "@agent/sandbox";
import type { AgentEvent } from "@agent/shared";

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
    description: "Read a text file. The path is relative to the repo root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
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
];

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
      case "read_file":
        return sandbox.readFile(input.path);
      case "write_file":
        await sandbox.writeFile(input.path, input.content);
        emit({ type: "file.changed", path: input.path });
        return `Wrote ${input.path}`;
      default:
        return `Unknown tool: ${call.name}`;
    }
  }
}
