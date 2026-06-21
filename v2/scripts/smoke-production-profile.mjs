#!/usr/bin/env node
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorDir = resolve(__dirname, "../orchestrator-rust");
const binaryPath = resolve(orchestratorDir, "target/debug/cosyworld-orchestrator");
const feedToken = "cosyworld-production-profile-smoke-token";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertBuiltBinary() {
  try {
    await access(binaryPath, constants.X_OK);
  } catch {
    throw new Error(`Missing orchestrator binary at ${binaryPath}. Run cargo build first.`);
  }
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  return server.address().port;
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function productionFeedServer() {
  const stats = { requests: 0, authorized: 0 };
  const body = JSON.stringify({
    wallets: [
      {
        walletAddress: "production-wallet",
        cardIds: ["rati", "location-science-lab", "location-library"],
      },
    ],
  });
  const server = createServer((request, response) => {
    if (request.url !== "/ownership") {
      response.writeHead(404).end();
      return;
    }
    stats.requests += 1;
    if (request.headers.authorization !== `Bearer ${feedToken}`) {
      response.writeHead(403).end();
      return;
    }
    stats.authorized += 1;
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  });
  const port = await listen(server);
  return {
    server,
    stats,
    url: `http://127.0.0.1:${port}/ownership`,
  };
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function waitForMeta(baseUrl, proc, outputLines) {
  const deadline = Date.now() + 8_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/meta`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  throw new Error(
    `production profile server did not become ready: ${lastError?.message || "unknown error"}\n`
      + outputLines.slice(-40).join(""),
  );
}

function terminate(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  proc.kill("SIGTERM");
  return new Promise((resolveTerminate) => {
    const timeout = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      resolveTerminate();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolveTerminate();
    });
  });
}

async function main() {
  await assertBuiltBinary();
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-production-profile-"));
  const feed = await productionFeedServer();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const outputLines = [];

  const env = { ...process.env };
  for (const key of [
    "COSYWORLD_RUBY_HIGH_WALLET_CARDS",
    "COSYWORLD_RUBY_HIGH_WALLET_CARDS_PATH",
    "COSYWORLD_DEV_TRUST_CLIENT_CARD_IDS",
    "COSYWORLD_ENABLE_DEV_RESET",
    "COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET",
    "COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS",
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    COSYWORLD_DEPLOY_PROFILE: "production",
    COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
    COSYWORLD_DISABLE_CTRL_C_SHUTDOWN: "1",
    COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL: feed.url,
    COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER: feedToken,
    COSYWORLD_RUBY_HIGH_WALLET_CARDS_REFRESH_SECS: "0",
    COSYWORLD_MODERATION_TOKEN: "production-profile-smoke-moderator",
    COSYWORLD_BOX_BURN_SOLANA_RPC_URL: "http://127.0.0.1:9/solana",
    COSYWORLD_BOX_CORE_COLLECTION_ADDRESS: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    COSYWORLD_V2_SNAPSHOT_PATH: resolve(tempDir, "snapshot.json"),
    COSYWORLD_V2_EVENT_DB_PATH: resolve(tempDir, "events.sqlite"),
  });

  const proc = spawn(binaryPath, {
    cwd: orchestratorDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => outputLines.push(chunk.toString()));
  proc.stderr.on("data", (chunk) => outputLines.push(chunk.toString()));

  try {
    const meta = await waitForMeta(baseUrl, proc, outputLines);
    assert(meta.ok === true, `production meta should be ok: ${JSON.stringify(meta)}`);
    assert(meta.deployment?.profile === "production", `expected production profile: ${JSON.stringify(meta.deployment)}`);
    assert(meta.deployment?.production === true, `expected production=true: ${JSON.stringify(meta.deployment)}`);
    assert(meta.ownership_feed?.remote_configured === true, `expected remote feed: ${JSON.stringify(meta.ownership_feed)}`);
    assert(meta.ownership_feed?.bearer_configured === true, `expected bearer feed: ${JSON.stringify(meta.ownership_feed)}`);
    assert(meta.ownership_feed?.wallet_count === 1, `expected remote wallet count: ${JSON.stringify(meta.ownership_feed)}`);
    assert(meta.features?.dev_reset_enabled === false, `dev reset must be off: ${JSON.stringify(meta.features)}`);
    assert(meta.features?.unsigned_wallet_claims_enabled === false, `unsigned wallets must be off: ${JSON.stringify(meta.features)}`);
    assert(meta.features?.trust_client_card_ids === false, `client card trust must be off: ${JSON.stringify(meta.features)}`);
    assert(meta.features?.moderation_audit_enabled === true, `moderation must be configured: ${JSON.stringify(meta.features)}`);
    assert(meta.persistence?.event_store_enabled === true, `event store must be enabled: ${JSON.stringify(meta.persistence)}`);
    assert(meta.nft?.box_burn_verifier_configured === true, `Box burn verifier must be configured: ${JSON.stringify(meta.nft)}`);
    assert(feed.stats.requests >= 1, "production profile should fetch the remote ownership feed");
    assert(feed.stats.authorized >= 1, "production profile should use the feed bearer token");
    console.log(JSON.stringify({
      ok: true,
      profile: meta.deployment.profile,
      wallet_count: meta.ownership_feed.wallet_count,
      feed_requests: feed.stats.requests,
      authorized_feed_requests: feed.stats.authorized,
    }, null, 2));
  } finally {
    await terminate(proc);
    await closeServer(feed.server);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
