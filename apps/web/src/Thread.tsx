import { useEffect, useRef } from "react";
import type { AgentEvent } from "@agent/shared";

// A chat is a list of items. We rebuild it from the events on every render, which is cheap.
type Item =
  | { kind: "status" | "text" | "action" | "error"; text: string }
  | { kind: "command"; command: string; output: string };

function toItems(events: AgentEvent[]): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    const input = (e.type === "tool.call" ? e.input : {}) as Record<string, string>;
    switch (e.type) {
      case "sandbox.ready":
        items.push({ kind: "status", text: "Sandbox ready" });
        break;
      case "clone.done":
        items.push({ kind: "status", text: `Cloned repo (${e.fileCount} files)` });
        break;
      case "agent.message":
        items.push({ kind: "text", text: e.text });
        break;
      case "tool.call":
        if (e.name === "run_command") items.push({ kind: "command", command: input.command, output: "" });
        if (e.name === "read_file") items.push({ kind: "action", text: `Read ${input.path}` });
        break;
      case "terminal.output": {
        const last = items.at(-1);
        if (last?.kind === "command") last.output += e.chunk;
        break;
      }
      case "file.changed":
        items.push({ kind: "action", text: `Edited ${e.path}` });
        break;
      case "tool.result":
        if (e.output.startsWith("Error:")) items.push({ kind: "error", text: e.output });
        break;
      case "run.failed":
        items.push({ kind: "error", text: e.error });
        break;
    }
  }
  return items;
}

export function Thread(props: { runId: string; repoUrl: string; task: string; events: AgentEvent[] }) {
  const { runId, repoUrl, task, events } = props;
  const items = toItems(events);
  const last = events.at(-1);
  const finished = last?.type === "run.completed" || last?.type === "run.failed";

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="thread">
      <div className="bubble user">
        {task}
        <small>{repoUrl || "New project (no repo)"}</small>
      </div>

      {items.map((item, i) => {
        switch (item.kind) {
          case "command":
            return (
              <details key={i} className="cmd" open={!finished && i === items.length - 1}>
                <summary>
                  Ran <code>{item.command}</code>
                </summary>
                <pre>{item.output || "(no output yet)"}</pre>
              </details>
            );
          default:
            return (
              <div key={i} className={item.kind}>
                {item.text}
              </div>
            );
        }
      })}

      {!finished && <div className="working">Working…</div>}

      {last?.type === "run.completed" && (
        <>
          <div className="text">{last.summary}</div>
          <Diff diff={last.diff} />
          <a className="download" href={`/runs/${runId}/download`}>
            Download zip
          </a>
        </>
      )}
      <div ref={bottom} />
    </div>
  );
}

// Split a `git diff` into one block per file.
function parseDiff(diff: string) {
  return diff
    .split(/^(?=diff --git )/m)
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.trimEnd().split("\n");
      const hunks = lines.slice(Math.max(lines.findIndex((l) => l.startsWith("@@")), 0));
      return {
        name: lines[0].split(" b/")[1] ?? lines[0],
        added: hunks.filter((l) => l.startsWith("+")).length,
        removed: hunks.filter((l) => l.startsWith("-")).length,
        hunks,
      };
    });
}

function Diff({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  if (files.length === 0) return <div className="status">No changes.</div>;

  return (
    <div className="diff">
      <div className="diff-title">{files.length} file(s) changed</div>
      {files.map((f) => (
        <details key={f.name} open>
          <summary>
            <code>{f.name}</code>
            <span className="add-count">+{f.added}</span>
            <span className="del-count">−{f.removed}</span>
          </summary>
          <pre>
            {f.hunks.map((line, i) => (
              <div key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>
                {line || " "}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
