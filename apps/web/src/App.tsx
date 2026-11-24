import { useEffect, useState } from "react";
import {
  MODELS,
  type AgentEvent,
  type ChatSummary,
  type CreateRunRequest,
  type CreateRunResponse,
} from "@agent/shared";
import { Composer } from "./Composer";
import { Settings, providerLabel, type SettingsValue } from "./Settings";
import { Sidebar } from "./Sidebar";
import { Thread } from "./Thread";

export function App() {
  const [settings, setSettings] = useState<SettingsValue>({
    provider: "anthropic",
    model: MODELS.anthropic[0],
    apiKey: "", // kept in memory only, never saved
  });
  const [showSettings, setShowSettings] = useState(true); // opens on load so you can paste your API key
  const [sidebarOpen, setSidebarOpen] = useState(false); // the drawer, on small screens
  const [chatId, setChatId] = useState<string>(); // set once the first message is sent, or a saved chat is opened
  const [runId, setRunId] = useState<string>(); // the run being followed right now
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]); // the whole chat (all its runs) is derived from this
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [error, setError] = useState("");

  async function refreshChats() {
    const res = await fetch("/chats");
    if (res.ok) setChats(await res.json());
  }
  useEffect(() => void refreshChats(), []);

  async function deleteChat(chat: ChatSummary) {
    if (!confirm(`Delete "${chat.title}"? This removes its messages and saved files.`)) return;
    await fetch(`/chats/${chat.id}`, { method: "DELETE" });
    if (chat.id === chatId) newChat();
    void refreshChats();
  }

  async function openChat(id: string) {
    const { events } = await (await fetch(`/chats/${id}`)).json();
    setChatId(id);
    setRunId(undefined);
    setRunning(false);
    setEvents(events);
    setSidebarOpen(false);
  }

  function newChat() {
    setChatId(undefined);
    setRunId(undefined);
    setRunning(false);
    setEvents([]);
    setSidebarOpen(false);
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
      void refreshChats(); // a new chat appears in the sidebar
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
        void refreshChats();
      }
    };
    return () => source.close();
  }, [runId]);

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeId={chatId}
        busy={running}
        open={sidebarOpen}
        modelLabel={`${providerLabel(settings.provider)} · ${settings.model}`}
        onNew={newChat}
        onOpen={openChat}
        onDelete={deleteChat}
        onSettings={() => setShowSettings(true)}
        onClose={() => setSidebarOpen(false)}
      />

      <main>
        <header>
          <button className="icon menu" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <button className="model-chip" onClick={() => setShowSettings(true)}>
            {settings.model} ▾
          </button>
        </header>

        {events.length > 0 ? (
          <Thread runId={runId} chatId={chatId} running={running} events={events} />
        ) : (
          <div className="hero">
            <h1>What should we build?</h1>
            <div className="suggestions">
              {SUGGESTIONS.map((text) => (
                <button key={text} onClick={() => start("", text)}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bottom">
          {error && <p className="error">{error}</p>}
          <Composer
            running={running}
            inChat={!!chatId}
            onSend={start}
            onStop={() => fetch(`/runs/${runId}/cancel`, { method: "POST" })}
          />
        </div>
      </main>

      <Settings open={showSettings} value={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

const SUGGESTIONS = [
  "Build a todo app in plain HTML, CSS and JavaScript",
  "Create a React + Vite landing page",
  "Write a Node script that renames files by date",
];
