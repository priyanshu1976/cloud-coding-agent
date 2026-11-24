import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { AgentEvent } from "@agent/shared";

// A chat is a list of items. We rebuild it from the events on every render, which is cheap.
type Item =
  | { kind: "status" | "text" | "action" | "error" | "warn"; text: string }
  | { kind: "user"; text: string; repoUrl?: string }
  | { kind: "preview"; url: string }
  | { kind: "done"; summary: string; diff: string }
  | { kind: "command"; command: string; output: string };

function toItems(events: AgentEvent[]): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    const input = (e.type === "tool.call" ? e.input : {}) as Record<string, string>;
    switch (e.type) {
      case "user.message":
        items.push({ kind: "user", text: e.text, repoUrl: e.repoUrl });
        break;
      case "workspace.restored":
        items.push({ kind: "status", text: "Restored saved files" });
        break;
      case "preview.url":
        items.push({ kind: "preview", url: e.url });
        break;
      case "run.completed":
        // The final reply was already shown as an agent message; don't print it twice.
        const last = items.at(-1);
        const repeated = last?.kind === "text" && last.text.trim() === e.summary.trim();
        items.push({ kind: "done", summary: repeated ? "" : e.summary, diff: e.diff });
        break;
      case "sandbox.ready":
        items.push({ kind: "status", text: "Sandbox ready" });
        break;
      case "clone.done":
        items.push({ kind: "status", text: `Cloned repo (${e.fileCount} files)` });
        break;
      case "agent.message":
        if (e.text.trim()) items.push({ kind: "text", text: e.text });
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
        // A failed tool call is usually retried by the agent, so show it quietly. Only a failed run is red.
        if (e.output.startsWith("Error:")) items.push({ kind: "warn", text: `${e.name} failed: ${e.output.slice(7).split("\n")[0].slice(0, 160)}` });
        break;
      case "run.failed":
        items.push({ kind: "error", text: e.error });
        break;
    }
  }
  return items;
}

// `runId` is only set while this page has a live run; a chat opened from history has no zip to download.
export function Thread(props: { runId?: string; chatId?: string; running: boolean; events: AgentEvent[] }) {
  const { runId, chatId, running, events } = props;
  const items = toItems(events);
  const [stopped, setStopped] = useState<string[]>([]); // preview links the user has stopped
  const lastPreview = items.map((it) => it.kind).lastIndexOf("preview");

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  return (
    <div className="thread">
      {items.map((item, i) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={i} className="bubble user">
                {item.text}
                {i === 0 && <small>{item.repoUrl || "New project (no repo)"}</small>}
              </div>
            );
          case "done":
            return (
              <div key={i}>
                {item.summary && <Markdown>{item.summary}</Markdown>}
                <Diff diff={item.diff} />
                {runId && i === items.length - 1 && (
                  <a className="download" href={`/runs/${runId}/download`}>
                    Download zip
                  </a>
                )}
              </div>
            );
          case "preview": {
            // Like the zip, a preview only exists for a live run: its sandbox is gone once a saved chat is reopened.
            const live = runId && i === lastPreview && !stopped.includes(item.url);
            return live ? (
              <div key={i} className="preview">
                <a href={item.url} target="_blank" rel="noreferrer">Open preview ↗</a>
                <button
                  className="ghost"
                  onClick={() => {
                    setStopped([...stopped, item.url]);
                    void fetch(`/chats/${chatId}/stop-preview`, { method: "POST" });
                  }}
                >
                  Stop preview
                </button>
              </div>
            ) : (
              <div key={i} className="status">Preview ended</div>
            );
          }
          case "text":
            return <Markdown key={i}>{item.text}</Markdown>;
          case "command":
            return (
              <details key={i} className="cmd" open={running && i === items.length - 1}>
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

      {running && <div className="working">Working…</div>}
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
