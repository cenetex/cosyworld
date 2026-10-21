import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { narrativeContractCases } from "../../test/fixtures/card-narrative-contexts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary =
  process.env.COSYWORLD_SMOKE_BINARY ||
  resolve(root, "v2/orchestrator-rust/target/debug/cosyworld-orchestrator");
const directory = await mkdtemp(resolve(tmpdir(), "cosy-card-contract-"));
const listener = createServer();
await new Promise((ready) => listener.listen(0, "127.0.0.1", ready));
const port = listener.address().port;
await new Promise((closed) => listener.close(closed));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (
    /^(COSYWORLD_AI|OPENAI_|OPENROUTER_|COSYWORLD_AVATAR_OWNERSHIP_FEED_)/u.test(
      key,
    )
  )
    delete env[key];
}
Object.assign(env, {
  COSYWORLD_DEPLOY_PROFILE: "local",
  COSYWORLD_PRIMARY_GAME: "cards",
  COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
  COSYWORLD_CONTENT_REGISTRY_PATH: resolve(
    root,
    "v2/content/core-only/registry.json",
  ),
  COSYWORLD_CONTENT_ROOT: resolve(root, "v2/content"),
  COSYWORLD_V2_SNAPSHOT_PATH: resolve(directory, "snapshot.json"),
  COSYWORLD_V2_EVENT_DB_PATH: resolve(directory, "events.sqlite"),
  COSYWORLD_GENERATED_ASSET_DIR: resolve(directory, "generated"),
  COSYWORLD_DISABLE_CTRL_C_SHUTDOWN: "1",
});
const server = spawn(binary, [], {
  cwd: resolve(root, "v2/orchestrator-rust"),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  spawnError;
server.on("error", (error) => {
  spawnError = error;
});
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-4000);
  });

async function send(name, context, expected, headers = {}, raw) {
  const response = await fetch(`${base}/card-game/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: raw ?? JSON.stringify(context),
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.text();
  assert.equal(response.status, expected, `${name}: ${body}`);
  if (expected === 503)
    assert.equal(
      JSON.parse(body).error,
      "Story generation is waiting for its model connection.",
    );
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null)
      throw new Error(`Contract server exited: ${output}`);
    try {
      if (
        (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* Startup is bounded below. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Contract server did not start: ${output}`);
  const cases = narrativeContractCases();
  // 503 with this exact body proves a real browser request passed Rust's JSON
  // extraction and semantic validation, then stopped before any model call.
  for (const { name, context } of cases) await send(name, context, 503);
  const context = cases[0].context;
  await send(
    "null conversation actor",
    { ...context, conversation: [{ actorId: null, text: "bong" }] },
    422,
  );
  await send(
    "unknown conversation actor",
    { ...context, conversation: [{ actorId: "echo", text: "bong" }] },
    400,
  );
  await send("unknown request field", { ...context, extra: true }, 422);
  await send("malformed JSON", null, 400, {}, "{");
  await send("oversized request", null, 413, {}, "x".repeat(64 * 1024 + 1));
  await send("wrong content type", context, 415, {
    "Content-Type": "text/plain",
  });
  await send("cross-site request", context, 403, {
    Origin: "https://elsewhere.example",
  });
  console.log(
    `Card narrative contract: ${cases.length} real browser scenes accepted; rejection classes remain distinct; no model calls.`,
  );
} finally {
  if (server.exitCode === null && !spawnError) {
    server.kill("SIGTERM");
    await new Promise((done) => {
      const timer = setTimeout(() => {
        server.kill("SIGKILL");
        done();
      }, 2000);
      server.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
  await rm(directory, { recursive: true, force: true });
}
