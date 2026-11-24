// Saves a chat's sandbox files to Cloudflare R2 and puts them back later.
// R2 speaks the S3 protocol, so we use the S3 client. One tar.gz per chat.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "@agent/sandbox";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  throw new Error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED", // R2 does not accept the SDK's newer default checksums
});

const keyFor = (chatId: string) => `chats/${chatId}/workspace.tar.gz`;

/** Pack /workspace (with .git, without node_modules) and upload it. */
export async function saveWorkspace(chatId: string, sandbox: Sandbox) {
  const tar = await sandbox.exec("tar -czf /tmp/snapshot.tar.gz --exclude=node_modules .");
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.trim()}`);

  const local = join(tmpdir(), `${chatId}-snapshot.tar.gz`);
  await sandbox.download("/tmp/snapshot.tar.gz", local);
  try {
    await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: keyFor(chatId), Body: await readFile(local) }));
  } finally {
    await rm(local, { force: true });
  }
}

/** Download the chat's snapshot into an empty sandbox. Returns false if the chat has none yet. */
export async function restoreWorkspace(chatId: string, sandbox: Sandbox): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: keyFor(chatId) }));
    bytes = await object.Body!.transformToByteArray();
  } catch (err) {
    if (err instanceof Error && err.name === "NoSuchKey") return false;
    throw err;
  }

  const local = join(tmpdir(), `${chatId}-restore.tar.gz`);
  try {
    await writeFile(local, bytes);
    await sandbox.upload(local, "/tmp/restore.tar.gz"); // not snapshot.tar.gz: docker cp makes it root-owned
  } finally {
    await rm(local, { force: true });
  }
  const untar = await sandbox.exec("tar -xzf /tmp/restore.tar.gz");
  if (untar.exitCode !== 0) throw new Error(`untar failed: ${untar.stderr.trim()}`);
  return true;
}
