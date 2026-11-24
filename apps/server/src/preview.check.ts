// Quick self-check for the preview proxy: token, cookie, proxying, host rewrite, stop. Run: pnpm tsx src/preview.check.ts
import assert from "node:assert";
import http from "node:http";
import type { Sandbox } from "@agent/sandbox";
import { openPreview, stopPreview, hasPreview } from "./preview";

const seen: http.IncomingHttpHeaders[] = [];
const upstream = http.createServer((req, res) => { seen.push(req.headers); res.end("hello from sandbox"); });
await new Promise<void>((ok) => upstream.listen(0, "127.0.0.1", ok));
const upPort = (upstream.address() as { port: number }).port;

let destroyed = false;
const sandbox = { hostPort: async () => upPort, destroy: async () => { destroyed = true; } } as unknown as Sandbox;

const url = new URL(await openPreview("chat1", sandbox));
const base = `http://127.0.0.1:${url.port}`;
assert.equal((await fetch(base)).status, 403, "no token -> 403");
assert.equal((await fetch(`${base}/?t=wrong`)).status, 403, "bad token -> 403");

const first = await fetch(`${base}/page?x=1&t=${url.searchParams.get("t")}`, { redirect: "manual" });
assert.equal(first.status, 302);
assert.equal(first.headers.get("location"), "/page?x=1", "token dropped from address");
const cookie = first.headers.get("set-cookie")!.split(";")[0];

const ok = await fetch(`${base}/page`, { headers: { cookie } });
assert.equal(ok.status, 200);
assert.equal(await ok.text(), "hello from sandbox");
assert.equal(seen.at(-1)!.host, `localhost:${upPort}`, "Host rewritten for Vite");

assert.equal(await openPreview("chat1", sandbox), url.href, "same sandbox -> same link");
assert.ok(hasPreview("chat1", sandbox));
stopPreview("chat1");
assert.ok(destroyed && !hasPreview("chat1"), "stop destroys the sandbox");
await assert.rejects(fetch(base), "port closed after stop");
upstream.close();
console.log("preview checks passed");
