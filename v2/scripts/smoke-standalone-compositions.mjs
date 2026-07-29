#!/usr/bin/env node
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import Database from "better-sqlite3";

import { inspectActionJournal } from "./inspect-action-journal.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const v2Root = resolve(scriptDir, "..");
const orchestratorDir = resolve(v2Root, "orchestrator-rust");
const binaryPath = process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY
  ? resolve(process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY)
  : resolve(orchestratorDir, "target/debug/cosyworld-orchestrator");
const contentRoot = resolve(v2Root, "content");
const walletAddress = "standalone-composition-smoke";
const worldCases = [
  {
    label: "Core only",
    registryPath: resolve(contentRoot, "core-only/registry.json"),
    worldpackId: "cosyworld.core-only",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
    ],
    location: "The Cosy Cottage",
    locationPack: "cosyworld.core",
    selectedBy: "cosyworld.core",
    capability: "cosyworld.core/rules",
    offerVerb: "Notice",
    firstTaleQuestionIncludes: "washed garden path",
    marker: "core-only journal loop",
  },
  {
    label: "Ruby High only",
    registryPath: resolve(contentRoot, "ruby-high-only/registry.json"),
    worldpackId: "ruby-high.first-bell-only",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "ruby-high.first-bell",
    ],
    location: "Homeroom",
    locationPack: "ruby-high.first-bell",
    selectedBy: "ruby-high.first-bell",
    capability: "ruby-high.first-bell/rules",
    offerVerb: "Tune in",
    firstTaleAbsent: true,
    marker: "ruby-only journal loop",
  },
  {
    label: "Project89 three rings",
    registryPath: resolve(contentRoot, "project89/registry.json"),
    worldpackId: "project89.three-rings",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "project89.operation-liberation",
      "project89.perimeter-relay",
      "project89.open-signal-frontier",
      "project89.composition.three-rings",
    ],
    location: "Threshold Interface",
    locationPack: "project89.operation-liberation",
    selectedBy: null,
    capability: null,
    offerVerb: null,
    firstTaleQuestionIncludes: "convergence protocol",
    marker: "project89 journal loop",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  assert(response.ok, `${url} returned HTTP ${response.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForMeta(baseUrl, proc, output) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline && proc.exitCode === null) {
    try {
      return await fetchJson(`${baseUrl}/meta`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `standalone composition server did not become ready: ${
      lastError?.message || "unknown error"
    }\n${output.slice(-40).join("")}`,
  );
}

function stopServer(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  proc.kill("SIGTERM");
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      resolveStop();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}

async function startServer(tempDir, registryPath) {
  const port = await freePort();
  const output = [];
  const env = { ...process.env };
  for (const key of [
    "COSYWORLD_AI_API_KEY",
    "COSYWORLD_AI_BASE_URL",
    "COSYWORLD_AI_PROVIDER",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    COSYWORLD_CONTENT_REGISTRY_PATH: registryPath,
    COSYWORLD_CONTENT_ROOT: contentRoot,
    COSYWORLD_DEPLOY_PROFILE: "local",
    RUST_LOG: "cosyworld_orchestrator=info",
    COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
    COSYWORLD_DISABLE_CTRL_C_SHUTDOWN: "1",
    COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET: "1",
    COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS: "0",
    COSYWORLD_CANONICAL_LEASE_TTL_MS: "1000",
    COSYWORLD_V2_SNAPSHOT_PATH: resolve(tempDir, "snapshot.json"),
    COSYWORLD_V2_EVENT_DB_PATH: resolve(tempDir, "events.sqlite"),
    COSYWORLD_V2_GENERATED_ASSET_DIR: resolve(tempDir, "generated"),
    COSYWORLD_RUBY_HIGH_WALLET_CARDS: JSON.stringify({
      wallets: [{
        walletAddress,
        cardIds: ["location-homeroom"],
      }],
    }),
  });
  const proc = spawn(binaryPath, {
    cwd: orchestratorDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => output.push(chunk.toString()));
  proc.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  let meta;
  try {
    meta = await waitForMeta(baseUrl, proc, output);
  } catch (error) {
    await stopServer(proc);
    throw error;
  }
  return { proc, output, baseUrl, meta };
}

function stateUrl(baseUrl, actorId, actorSession) {
  const query = new URLSearchParams({
    actor_id: String(actorId),
    actor_session: actorSession,
    wallet_address: walletAddress,
  });
  return `${baseUrl}/state?${query}`;
}

async function command(baseUrl, actorId, actorSession, value) {
  const result = await postJson(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    command: value,
  });
  assert(result.ok === true, `${value} failed: ${JSON.stringify(result)}`);
  return result;
}

function assertMountedComposition(meta, spec) {
  assert(meta.worldpack?.id === spec.worldpackId, JSON.stringify(meta.worldpack));
  assert(
    meta.worldpack?.packs?.map((pack) => pack.id).join(",") === spec.packIds.join(","),
    `${spec.label} mounted the wrong packs: ${JSON.stringify(meta.worldpack?.packs)}`,
  );
}

function assertScene(state, spec, { requireOffer = true } = {}) {
  assert(state.location?.name === spec.location, JSON.stringify(state.location));
  if (spec.selectedBy) {
    assert(
      state.rules_context?.location_pack_id === spec.locationPack
        && state.rules_context?.selected_by_pack_id === spec.selectedBy
        && state.rules_context?.capability_id === spec.capability,
      `${spec.label} selected the wrong rules context: ${JSON.stringify(state.rules_context)}`,
    );
  } else {
    assert(
      state.rules_context == null,
      `${spec.label} unexpectedly selected a pack-local rules context: ${
        JSON.stringify(state.rules_context)
      }`,
    );
  }
  if (requireOffer) {
    if (spec.offerVerb) {
      assert(
        state.action_offers?.some((offer) => offer.verb === spec.offerVerb),
        `${spec.label} did not expose ${spec.offerVerb}: ${JSON.stringify(
          state.action_offers?.map(({ kind, verb }) => ({ kind, verb })),
        )}`,
      );
    } else {
      assert(
        state.action_offers?.length > 0,
        `${spec.label} exposed no legal action offers`,
      );
    }
  }
  if (spec.firstTaleAbsent) {
    assert(
      state.first_tale == null,
      `${spec.label} unexpectedly exposed a first tale: ${JSON.stringify(state.first_tale)}`,
    );
  }
  if (spec.firstTaleQuestionIncludes) {
    assert(
      state.first_tale?.question?.includes(spec.firstTaleQuestionIncludes),
      `${spec.label} exposed the wrong first-tale question: ${JSON.stringify(state.first_tale)}`,
    );
  }
}

async function runWorldLoop(spec) {
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-standalone-world-"));
  const eventDbPath = resolve(tempDir, "events.sqlite");
  let first = null;
  let restarted = null;
  try {
    first = await startServer(tempDir, spec.registryPath);
    assertMountedComposition(first.meta, spec);
    const created = await postJson(`${first.baseUrl}/avatar`, {
      name: `${spec.label} Walker`,
      wallet_address: walletAddress,
    });
    assert(created.ok && created.actor?.id && created.actor_session, JSON.stringify(created));
    const actorId = created.actor.id;
    const actorSession = created.actor_session;
    const initial = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assertScene(initial, spec);

    const listened = await command(first.baseUrl, actorId, actorSession, "listen");
    assert(
      listened.events?.length > 0,
      `${spec.label} Listen produced no committed events: ${JSON.stringify(listened)}`,
    );
    await command(first.baseUrl, actorId, actorSession, `say ${spec.marker}`);
    const committed = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assert(
      committed.world_seq > initial.world_seq,
      `${spec.label} action loop did not advance world sequence`,
    );
    await stopServer(first.proc);
    first = null;

    const registry = JSON.parse(await readFile(spec.registryPath, "utf8"));
    const inspection = inspectActionJournal(eventDbPath, registry, { limit: 100 });
    const durableJournalHead = Math.max(
      Number(inspection.compaction.action_journal_floor_seq),
      Number(inspection.window.last_seq ?? 0),
    );
    assert(
      durableJournalHead >= 3
        && inspection.records.length >= 1
        && inspection.summary.degraded_records === 0
        && inspection.summary.malformed_records === 0
        && inspection.summary.incompatible_bundle_records === 0,
      `${spec.label} journal was not replayable: ${JSON.stringify({
        window: inspection.window,
        compaction: inspection.compaction,
        summary: inspection.summary,
      })}`,
    );

    restarted = await startServer(tempDir, spec.registryPath);
    assertMountedComposition(restarted.meta, spec);
    assert(
      restarted.output.some((line) => line.includes("loaded journal checkpoint")),
      `${spec.label} restart did not use its journal checkpoint: ${
        restarted.output.slice(-40).join("")
      }`,
    );
    const replayed = await fetchJson(stateUrl(restarted.baseUrl, actorId, actorSession));
    assertScene(replayed, spec, { requireOffer: false });
    assert(
      replayed.world_seq >= committed.world_seq,
      `${spec.label} restart regressed ${committed.world_seq} to ${replayed.world_seq}`,
    );
    const query = new URLSearchParams({
      actor_id: String(actorId),
      actor_session: actorSession,
      wallet_address: walletAddress,
      limit: "500",
    });
    const events = await fetchJson(`${restarted.baseUrl}/events?${query}`);
    assert(
      events.events?.some((event) =>
        event.type === "message.created" && event.content === spec.marker),
      `${spec.label} restart lost ${spec.marker}`,
    );
    return {
      entry: spec.label,
      worldpack: spec.worldpackId,
      location: spec.location,
      journal_head: durableJournalHead,
      journal_records_retained: inspection.records.length,
      replayed: true,
    };
  } finally {
    if (first) await stopServer(first.proc);
    if (restarted) await stopServer(restarted.proc);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function journalCount(eventDbPath) {
  const database = new Database(eventDbPath, { readonly: true, fileMustExist: true });
  try {
    return Number(database.prepare("SELECT COUNT(*) FROM action_journal").pluck().get());
  } finally {
    database.close();
  }
}

async function assertServicesContract(server, expectedPackIds) {
  assert(
    server.meta.worldpack?.id === "cosyworld.services-only"
      && server.meta.world?.actor_count === 0
      && server.meta.world?.location_count === 0,
    `services-only seeded world state: ${JSON.stringify(server.meta)}`,
  );
  assert(
    server.meta.worldpack?.packs?.map((pack) => pack.id).join(",")
      === expectedPackIds.join(","),
    `services-only mounted the wrong packs: ${JSON.stringify(server.meta.worldpack?.packs)}`,
  );
  const catalogue = await fetchJson(`${server.baseUrl}/content-packs`);
  assert(
    catalogue.worldpack_id === "cosyworld.services-only"
      && catalogue.packs?.map((pack) => pack.id).join(",") === expectedPackIds.join(",")
      && catalogue.packs.every((pack) => pack.locations.length === 0),
    `services-only catalogue invented a world: ${JSON.stringify(catalogue)}`,
  );
  const licenses = await fetchJson(`${server.baseUrl}/licenses`);
  assert(
    licenses.worldpack_id === "cosyworld.services-only"
      && licenses.packs?.map((pack) => pack.pack_id).join(",") === expectedPackIds.join(",")
      && licenses.packs.some((pack) =>
        pack.notices?.some((notice) => notice.text.includes("System Reference Document 5.2.1"))),
    `services-only licenses are incomplete: ${JSON.stringify(licenses)}`,
  );
  const rejected = await postJson(`${server.baseUrl}/avatar`, {
    name: "No World Walker",
    wallet_address: walletAddress,
  });
  assert(
    rejected.ok === false
      && rejected.status === 503
      && rejected.actor === null
      && rejected.actor_session === null,
    `services-only did not refuse avatar creation deterministically: ${JSON.stringify(rejected)}`,
  );
}

async function runServicesLoop() {
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-standalone-services-"));
  const registryPath = resolve(contentRoot, "services-only/registry.json");
  const eventDbPath = resolve(tempDir, "events.sqlite");
  const expectedPackIds = [
    "cosyworld.rules-srd-5.2.1",
    "cosyworld.rules-profile-srd5",
    "cosyworld.services-fixture",
  ];
  let first = null;
  let restarted = null;
  try {
    first = await startServer(tempDir, registryPath);
    await assertServicesContract(first, expectedPackIds);
    assert(journalCount(eventDbPath) === 0, "services-only refusal wrote an action journal row");
    await stopServer(first.proc);
    first = null;

    restarted = await startServer(tempDir, registryPath);
    await assertServicesContract(restarted, expectedPackIds);
    assert(
      journalCount(eventDbPath) === 0,
      "services-only restart or refusal wrote an action journal row",
    );
    return {
      entry: "Engine services without an experience pack",
      worldpack: "cosyworld.services-only",
      catalogue_packs: expectedPackIds.length,
      avatar_status: 503,
      journal_records: 0,
      restarted: true,
    };
  } finally {
    if (first) await stopServer(first.proc);
    if (restarted) await stopServer(restarted.proc);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await access(binaryPath, constants.X_OK).catch(() => {
    throw new Error(`Missing orchestrator binary at ${binaryPath}. Build it before this smoke.`);
  });
  for (const spec of worldCases) await access(spec.registryPath, constants.R_OK);
  await access(resolve(contentRoot, "services-only/registry.json"), constants.R_OK);

  const matrix = [];
  for (const spec of worldCases) matrix.push(await runWorldLoop(spec));
  matrix.push(await runServicesLoop());
  console.log(JSON.stringify({ ok: true, matrix }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
