import { useEffect, useState } from "react";
import { MODELS, type AgentEvent, type CreateRunRequest, type CreateRunResponse } from "@agent/shared";
import { Composer } from "./Composer";
import { Settings, type SettingsValue } from "./Settings";
import { Thread } from "./Thread";

export function App() {
  const [settings, setSettings] = useState<SettingsValue>({
    provider: "anthropic",
    model: MODELS.anthropic[0],
    apiKey: "", // kept in memory only, never saved
  });
  const [showSettings, setShowSettings] = useState(true);
  const [task, setTask] = useState<{ repoUrl: string; task: string }>();
  const [runId, setRunId] = useState<string>();
  const [events, setEvents] = useState<AgentEvent[]>([]); // the whole thread is derived from this
  const [error, setError] = useState("");

  const last = events.at(-1);
  const finished = last?.type === "run.completed" || last?.type === "run.failed";
  const running = !!runId && !finished;

  async function start(repoUrl: string, taskText: string) {
    if (!settings.apiKey) {
      setError("Add your API key in Settings first.");
      setShowSettings(true);
      return;
    }
    setError("");
    try {
      const body: CreateRunRequest = { ...settings, repoUrl: repoUrl || undefined, task: taskText };
      const res = await fetch("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start the run");
      const { runId } = (await res.json()) as CreateRunResponse;
      setShowSettings(false);
      setTask({ repoUrl, task: taskText });
      setEvents([]);
      setRunId(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Follow the run's events. If the connection drops, the browser reconnects
  // by itself and the server replays what we missed.
  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/runs/${runId}/events`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as AgentEvent;
      setEvents((prev) => [...prev, event]);
      if (event.type === "run.completed" || event.type === "run.failed") source.close();
    };
    return () => source.close();
  }, [runId]);

  return (
    <div className="app">
      <header>
        <strong>Cloud Agent</strong>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
          Settings
        </button>
      </header>

      {showSettings && <Settings value={settings} onChange={setSettings} />}

      {runId && task ? (
        <Thread runId={runId} repoUrl={task.repoUrl} task={task.task} events={events} />
      ) : (
        <div className="hero">
          <h1>What should we work on?</h1>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <Composer
        running={running}
        onSend={start}
        onStop={() => fetch(`/runs/${runId}/cancel`, { method: "POST" })}
      />
    </div>
  );
}
