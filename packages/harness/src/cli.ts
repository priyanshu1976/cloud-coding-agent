// Run the agent from the terminal, no server or browser needed:
//   API_KEY=sk-... pnpm --filter @agent/harness cli https://github.com/user/repo "add a README"
//   API_KEY=sk-... pnpm --filter @agent/harness cli "build a todo app in plain HTML"   (no repo)
// Optional env vars: PROVIDER (anthropic | openai | gemini | sarvam), MODEL (default: the provider's first model)
import { createLLM } from "@agent/ai";
import { createSandbox } from "@agent/sandbox";
import { MODELS, type Provider } from "@agent/shared";
import { runAgent } from "./index";

const args = process.argv.slice(2);
const task = args.pop(); // the last argument is the task; an optional repo URL comes before it
const repoUrl = args[0];
const apiKey = process.env.API_KEY;
if (!task || !apiKey) {
  console.error('Usage: API_KEY=... cli [repoUrl] "<task>"   (no repoUrl = new project)');
  process.exit(1);
}

const provider = (process.env.PROVIDER ?? "anthropic") as Provider;
const llm = createLLM({ provider, apiKey, model: process.env.MODEL ?? MODELS[provider][0] });

const sandbox = await createSandbox({ image: "cloud-agent-sandbox" });
try {
  const { summary, diff } = await runAgent({
    repoUrl,
    task,
    llm,
    sandbox,
    emit: (e) => console.log(e),
  });
  console.log("\nSUMMARY:", summary, "\n\nDIFF:\n" + diff);
} finally {
  await sandbox.destroy();
}
