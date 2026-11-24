// Lets the browser reach a dev server running inside a sandbox.
// Each preview gets its own public port (4000-4099) and a secret token. The proxy forwards
// requests to the sandbox's published port, WebSockets included, so hot reload works.
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { PREVIEW_PORT } from "@agent/shared";
import type { Sandbox } from "@agent/sandbox";

const FIRST_PORT = 4000;
const LAST_PORT = 4099;
const IDLE_MS = 30 * 60_000; // no requests for this long: stop the preview and its sandbox

type Preview = { sandbox: Sandbox; url: string; stop: () => void };

// ponytail: one preview per chat, in memory. A server restart forgets them (Docker removes the sandbox within the hour).
const previews = new Map<string, Preview>();

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Open a public port for this sandbox's dev server. Returns the link to show the user. */
// `host` is the name the user's browser used to reach this server; PREVIEW_HOST overrides it.
export async function openPreview(chatId: string, sandbox: Sandbox, host = "localhost"): Promise<string> {
  const existing = previews.get(chatId);
  if (existing?.sandbox === sandbox) return existing.url; // the agent restarted its server: same link
  existing?.stop();

  const target = await sandbox.hostPort(PREVIEW_PORT);
  const token = randomBytes(24).toString("hex");
  let cookieName = "";
  let idle: NodeJS.Timeout;

  const cookieOk = (req: http.IncomingMessage) =>
    (req.headers.cookie ?? "").split(/;\s*/).some((c) => same(c, `${cookieName}=${token}`));
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stop(), IDLE_MS);
  };
  // The sandbox's server thinks it is on localhost; Vite refuses other Host and Origin values.
  const upstreamHeaders = (req: http.IncomingMessage) => ({
    ...req.headers,
    host: `localhost:${target}`,
    ...(req.headers.origin ? { origin: `http://localhost:${target}` } : {}),
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!cookieOk(req)) {
      if (!same(url.searchParams.get("t") ?? "", token)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      // First visit with the token: remember it in a cookie and drop it from the address bar.
      url.searchParams.delete("t");
      res.writeHead(302, {
        "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax`,
        Location: url.pathname + url.search,
      }).end();
      return;
    }
    touch();
    const upstream = http.request(
      { host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: upstreamHeaders(req) },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end("The preview server is not responding."));
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!cookieOk(req)) return void socket.destroy();
    touch();
    const upstream = net.connect(target, "127.0.0.1", () => {
      const headers = Object.entries(upstreamHeaders(req)).flatMap(([k, v]) => [`${k}: ${[v].flat().join(", ")}`]);
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  const port = await listenOnFreePort(server);
  cookieName = `preview_${port}`; // cookies ignore ports, so each preview needs its own name

  const stop = () => {
    clearTimeout(idle);
    server.close();
    server.closeAllConnections();
    if (previews.get(chatId) === preview) previews.delete(chatId);
    void sandbox.destroy();
  };
  const url = `http://${process.env.PREVIEW_HOST ?? host}:${port}/?t=${token}`;
  const preview: Preview = { sandbox, url, stop };
  previews.set(chatId, preview);
  touch();
  return url;
}

export function stopPreview(chatId: string) {
  previews.get(chatId)?.stop();
}

export const hasPreview = (chatId: string, sandbox?: Sandbox) =>
  previews.has(chatId) && (!sandbox || previews.get(chatId)?.sandbox === sandbox);

async function listenOnFreePort(server: http.Server): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    try {
      await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(port, "0.0.0.0", () => {
          server.off("error", fail);
          ok();
        });
      });
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error("No free preview ports");
}
