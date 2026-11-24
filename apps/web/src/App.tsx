import { useEffect, useState } from "react";
import {
  MODELS,
  type AgentEvent,
  type ChatSummary,
  type CreateRunRequest,
  type CreateRunResponse,
} from "@agent/shared";
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
  const [chatId, setChatId] = useState<string>(); // set once the first message is sent, or a saved chat is opened
  const [runId, setRunId] = useState<string>(); // the run being followed right now
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]); // the whole chat (all its runs) is derived from this
  const [chats, setChats] = useState<ChatSummary[]>();
  const [error, setError] = useState("");

  async function toggleHistory() {
    if (chats) return setChats(undefined);
    setChats(await (await fetch("/chats")).json());
  }

  async function openChat(id: string) {
    const { events } = await (await fetch(`/chats/${id}`)).json();
    setChatId(id);
    setRunId(undefined);
    setRunning(false);
    setEvents(events);
    setChats(undefined);
  }

  function newChat() {
    setChatId(undefined);
    setRunId(undefined);
    setRunning(false);
    setEvents([]);
    setChats(undefined);
  }

  async function start(repoUrl: string, taskText: string) {
    if (!settings.apiKey) {
      setError("Add your API key in Settings first.");
      setShowSettings(true);
      return;
    }
    setError("");
    try {
      const body: CreateRunRequest = { ...settings, chatId, repoUrl: repoUrl || undefined, task: taskText };
      const res = await fetch("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start the run");
      const created = (await res.json()) as CreateRunResponse;
      setShowSettings(false);
      setChats(undefined);
      if (!chatId) setEvents([]); // a new chat starts empty; a continued chat keeps its history
      setChatId(created.chatId);
      setRunId(created.runId);
      setRunning(true);
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
      if (event.type === "run.completed" || event.type === "run.failed") {
        setRunning(false);
        source.close();
      }
    };
    return () => source.close();
  }, [runId]);

  return (
    <div className="app">
      <header>
        <strong>Cloud Agent</strong>
        <div>
          <button className="ghost" onClick={newChat} disabled={running}>
            New chat
          </button>{" "}
          <button className="ghost" onClick={toggleHistory}>
            History
          </button>{" "}
          <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
            Settings
          </button>
        </div>
      </header>

      {showSettings && <Settings value={settings} onChange={setSettings} />}

      {chats && (
        <div className="settings">
          {chats.length === 0 && "No saved chats yet."}
          {chats.map((c) => (
            <button key={c.id} className="ghost" disabled={running} onClick={() => openChat(c.id)}>
              {c.title}
            </button>
          ))}
        </div>
      )}

      {events.length > 0 ? (
        <Thread runId={runId} running={running} events={events} />
      ) : (
        <div className="hero">
          <h1>What should we work on?</h1>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <Composer
        running={running}
        inChat={!!chatId}
        onSend={start}
        onStop={() => fetch(`/runs/${runId}/cancel`, { method: "POST" })}
      />
    </div>
  );
}
