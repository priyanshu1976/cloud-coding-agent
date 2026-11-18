import express from "express";
import { MODELS, type CreateRunRequest, type CreateRunResponse } from "@agent/shared";
import { cancelRun, runs, startRun } from "./runs";

const app = express();
app.use(express.json());

// Start a run. The API key lives only in this request and the run's closure; it is never stored or logged.
app.post("/runs", (req, res) => {
  const b = req.body as Partial<CreateRunRequest>;
  const valid =
    [b.task, b.apiKey].every((v) => typeof v === "string" && v !== "") &&
    (b.repoUrl === undefined || (typeof b.repoUrl === "string" && b.repoUrl.startsWith("https://"))) &&
    b.provider! in MODELS &&
    (MODELS[b.provider!] as readonly string[]).includes(b.model!);
  if (!valid) {
    res.status(400).json({
      error: "Need a task, apiKey, a provider with one of its models, and (optionally) an https repoUrl.",
    });
    return;
  }
  const response: CreateRunResponse = { runId: startRun(b as CreateRunRequest) };
  res.json(response);
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

app.listen(3001, () => console.log("server on http://localhost:3001"));
