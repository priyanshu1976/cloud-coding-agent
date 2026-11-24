import express from "express";
import { MODELS, type CreateRunRequest, type CreateRunResponse } from "@agent/shared";
import { getChat, listChats } from "@agent/db";
import { cancelRun, runs, startRun } from "./runs";

const app = express();
app.use(express.json());

// Start a run. The API key lives only in this request and the run's closure; it is never stored or logged.
app.post("/runs", async (req, res) => {
  const b = req.body as Partial<CreateRunRequest>;
  const valid =
    [b.task, b.apiKey].every((v) => typeof v === "string" && v !== "") &&
    (b.repoUrl === undefined || (typeof b.repoUrl === "string" && b.repoUrl.startsWith("https://"))) &&
    (b.chatId === undefined || typeof b.chatId === "string") &&
    b.provider! in MODELS &&
    (MODELS[b.provider!] as readonly string[]).includes(b.model!);

  if (!valid) {
    res.status(400).json({
      error: "Need a task, apiKey, a provider with one of its models, and (optionally) an https repoUrl.",
    });
    return;
  }
  const chat = b.chatId ? await getChat(b.chatId) : undefined;
  if (b.chatId && !chat) {
    res.status(404).json({ error: "That chat does not exist." });
    return;
  }

  const response: CreateRunResponse = await startRun(b as CreateRunRequest, chat);
  res.json(response);
});

// Saved chats: the list, and one chat's events so the page can show it again.
app.get("/chats", async (_req, res) => {
  res.json(await listChats());
});

app.get("/chats/:id", async (req, res) => {
  const chat = await getChat(req.params.id);
  if (!chat) {
    res.sendStatus(404);
    return;
  }
  res.json({ events: chat.events });
});

// Live events (SSE). A reconnecting browser sends Last-Event-ID, so we replay only what it missed.
app.get("/runs/:id/events", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.sendStatus(404);
    return;
  }

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.flushHeaders();

  const send = (i: number) => res.write(`id: ${i}\ndata: ${JSON.stringify(run.events[i])}\n\n`);
  const firstMissed = Number(req.get("Last-Event-ID") ?? -1) + 1;
  for (let i = firstMissed; i < run.events.length; i++) send(i);

  run.listeners.add(send);
  req.on("close", () => run.listeners.delete(send));
});

app.post("/runs/:id/cancel", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.sendStatus(404);
    return;
  }
  cancelRun(run);
  res.sendStatus(204);
});

app.get("/runs/:id/download", (req, res) => {
  const zipPath = runs.get(req.params.id)?.zipPath;
  if (!zipPath) {
    res.sendStatus(404);
    return;
  }
  res.download(zipPath, "result.zip");
});

// HOST is set to 127.0.0.1 in production so only the reverse proxy can reach us.
app.listen(3001, process.env.HOST ?? "::", () => console.log("server on port 3001"));
