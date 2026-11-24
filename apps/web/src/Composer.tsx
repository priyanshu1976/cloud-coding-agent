import { useState } from "react";

export function Composer({
  running,
  inChat,
  onSend,
  onStop,
}: {
  running: boolean;
  inChat: boolean; // a chat is open: it already has its files, so there is no repo to choose
  onSend: (repoUrl: string, task: string) => void;
  onStop: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [task, setTask] = useState("");
  const canSend = !running && task.trim() !== ""; // the repo is optional

  function send() {
    if (!canSend) return;
    onSend(repoUrl.trim(), task.trim());
    setTask("");
  }

  return (
    <div className="composer">
      {!inChat && (
        <input
          className="repo"
          placeholder="GitHub repo URL (optional). Leave empty to start a new project"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
      )}
      <div className="row">
        <textarea
          rows={1}
          placeholder="Ask the agent to change something…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button className="round" title="Stop" onClick={onStop}>
            ■
          </button>
        ) : (
          <button className="round" title="Send" disabled={!canSend} onClick={send}>
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
