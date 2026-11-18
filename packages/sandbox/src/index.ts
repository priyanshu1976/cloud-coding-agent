// A sandbox is one Docker container. We talk to it by running the `docker` CLI.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

export interface Sandbox {
  /** Run a bash command in /workspace. If it hits the timeout, exitCode is 124. */
  exec(
    cmd: string,
    opts?: { timeoutMs?: number; onOutput?: (chunk: string) => void },
  ): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Copy a file from the container to the host. */
  download(containerPath: string, hostPath: string): Promise<void>;
  destroy(): Promise<void>;
}

const MAX_OUTPUT = 1_000_000; // characters kept per command

/** Run `docker <args>` on the host and collect its output. */
function docker(
  args: string[],
  opts: { input?: string; onOutput?: (chunk: string) => void } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    let stdout = "";
    let stderr = "";
    let size = 0;

    const collect = (isStderr: boolean) => (chunk: string) => {
      if (size > MAX_OUTPUT) return; // ponytail: drops output past 1MB so a noisy command can't eat memory
      size += chunk.length;
      if (isStderr) stderr += chunk;
      else stdout += chunk;
      opts.onOutput?.(chunk);
    };
    child.stdout.setEncoding("utf8").on("data", collect(false));
    child.stderr.setEncoding("utf8").on("data", collect(true));

    child.on("error", reject); // e.g. docker is not installed
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.stdin.end(opts.input);
  });
}

function mustSucceed(result: ExecResult, what: string) {
  if (result.exitCode !== 0) throw new Error(`${what} failed: ${result.stderr.trim()}`);
}

export async function createSandbox(opts: {
  image: string;
  memory?: string;
  cpus?: number;
}): Promise<Sandbox> {
  const name = `agent-${randomUUID()}`;

  // --rm + `sleep 3600`: if we ever forget to destroy it, Docker removes it after an hour.
  mustSucceed(
    await docker([
      "run", "-d", "--rm", "--name", name,
      "--memory", opts.memory ?? "1g",
      "--cpus", String(opts.cpus ?? 1),
      "--pids-limit", "256",
      opts.image, "sleep", "3600",
    ]),
    "docker run",
  );

  return {
    exec(cmd, { timeoutMs = 120_000, onOutput } = {}) {
      // `timeout` runs inside the container, so it really stops the command
      // (killing the host-side `docker exec` process would not).
      const seconds = String(Math.ceil(timeoutMs / 1000));
      return docker(["exec", name, "timeout", "-k", "5", seconds, "bash", "-c", cmd], { onOutput });
    },

    async readFile(path) {
      const result = await docker(["exec", name, "cat", path]);
      mustSucceed(result, `read ${path}`);
      return result.stdout;
    },

    async writeFile(path, content) {
      // The path is passed as an argument ($1), never pasted into the shell string.
      const script = 'mkdir -p "$(dirname "$1")" && cat > "$1"';
      const result = await docker(["exec", "-i", name, "sh", "-c", script, "sh", path], {
        input: content,
      });
      mustSucceed(result, `write ${path}`);
    },

    async download(containerPath, hostPath) {
      mustSucceed(await docker(["cp", `${name}:${containerPath}`, hostPath]), "docker cp");
    },

    async destroy() {
      await docker(["rm", "-f", name]);
    },
  };
}
