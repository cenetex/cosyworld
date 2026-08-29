#!/usr/bin/env node
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

import Database from "better-sqlite3";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const v2Root = resolve(scriptDir, "..");
const orchestratorDir = resolve(v2Root, "orchestrator-rust");
const binaryPath = process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY
  ? resolve(process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY)
  : resolve(orchestratorDir, "target/debug/cosyworld-orchestrator");
const coreOnlyRegistryPath = resolve(v2Root, "content/core-only/registry.json");
const coreRubyRegistryPath = resolve(v2Root, "content/core-ruby/registry.json");
const contentRoot = resolve(v2Root, "content");
const packMigrationPath = resolve(v2Root, "scripts/migrate-pack-unmount.mjs");
const journalInspectionPath = resolve(v2Root, "scripts/inspect-action-journal.mjs");

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

async function postJsonWithStatus(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

async function postJsonExpectingStatus(url, body, expectedStatus) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${url} returned HTTP ${response.status} with invalid JSON: ${text.slice(0, 400)} (${error.message})`,
    );
  }
  assert(
    response.status === expectedStatus,
    `${url} returned HTTP ${response.status}, expected ${expectedStatus}: ${text.slice(0, 400)}`,
  );
  assert(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    `${url} returned HTTP ${response.status} with a non-object JSON response: ${text.slice(0, 400)}`,
  );
  assert(
    parsed.status === expectedStatus,
    `${url} returned JSON status ${parsed.status}, expected ${expectedStatus}: ${text.slice(0, 400)}`,
  );
  return parsed;
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
    `Core + Ruby server did not become ready: ${lastError?.message || "unknown error"}\n`
      + output.slice(-40).join(""),
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

async function startServer(tempDir, registryPath, snapshotPath) {
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
    COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS: "0",
    COSYWORLD_CANONICAL_LEASE_TTL_MS: "1000",
    // This lifecycle proof compares the same historical Ruby record before
    // unmount and after remount. Preserve full history here; the standalone
    // composition smoke exercises the default checkpoint compaction policy.
    COSYWORLD_V2_PERSISTENCE_COMPACTION: "off",
    COSYWORLD_V2_SNAPSHOT_PATH: snapshotPath,
    COSYWORLD_V2_EVENT_DB_PATH: resolve(tempDir, "events.sqlite"),
    COSYWORLD_V2_GENERATED_ASSET_DIR: resolve(tempDir, "generated"),
  });
  const proc = spawn(binaryPath, {
    cwd: orchestratorDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => output.push(chunk.toString()));
  proc.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const meta = await waitForMeta(baseUrl, proc, output);
  return { proc, output, baseUrl, meta };
}

async function waitForActorJobs(eventDbPath) {
  // A player-tick retry can include the resident heartbeat delay plus the
  // worker's idle poll. Leave enough room for all durable retry attempts.
  // Pending room-rope jobs are timers, not in-flight work. The pack migration
  // retires them after shutdown so disconnected players are never auto-passed
  // when the migrated server starts again.
  const deadline = Date.now() + 30_000;
  let activeJobs = [];
  while (Date.now() < deadline) {
    const database = new Database(eventDbPath, { readonly: true });
    activeJobs = database.prepare(`
      SELECT id, kind, actor_id, status, attempts, available_at_ms, lease_until_ms, last_error
      FROM actor_jobs
      WHERE status = 'running'
         OR (status = 'pending' AND kind != 'room_rope')
      ORDER BY id
    `).all();
    database.close();
    if (activeJobs.length === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(
    `actor jobs did not become quiescent before pack migration: ${JSON.stringify(activeJobs)}`,
  );
}

function migratePack(operation, snapshotPath, eventDbPath, sourceRegistry, targetRegistry) {
  const migrated = spawnSync(process.execPath, [
    packMigrationPath,
    "--operation",
    operation,
    "--input",
    snapshotPath,
    "--output",
    snapshotPath,
    "--event-db",
    eventDbPath,
    "--registry",
    sourceRegistry,
    "--target-registry",
    targetRegistry,
    "--pack",
    "ruby-high.first-bell",
  ], { cwd: resolve(v2Root, ".."), encoding: "utf8" });
  assert(migrated.status === 0, migrated.stderr || migrated.stdout);
  return migrated.stdout;
}

function inspectJournal(eventDbPath, registryPath) {
  const inspected = spawnSync(process.execPath, [
    journalInspectionPath,
    "--event-db",
    eventDbPath,
    "--registry",
    registryPath,
    "--limit",
    "500",
  ], { cwd: resolve(v2Root, ".."), encoding: "utf8" });
  assert(inspected.status === 0, inspected.stderr || inspected.stdout);
  return JSON.parse(inspected.stdout);
}

function assertFrozenStateRestored(frozen, snapshot) {
  for (const [field, entries] of Object.entries(frozen.arrays ?? {})) {
    const active = snapshot[field] ?? [];
    for (const entry of entries) {
      const expected = entry.value ?? entry;
      assert(
        active.some((candidate) => isDeepStrictEqual(candidate, expected)),
        `remount changed frozen ${field} entry ${JSON.stringify(expected)}`,
      );
    }
  }
  for (const [field, entries] of Object.entries(frozen.maps ?? {})) {
    for (const [key, value] of Object.entries(entries)) {
      assert(
        isDeepStrictEqual(snapshot[field]?.[key], value),
        `remount changed frozen ${field}.${key}`,
      );
    }
  }
  for (const [field, entries] of Object.entries(frozen.world_simulation ?? {})) {
    for (const [key, value] of Object.entries(entries)) {
      assert(
        isDeepStrictEqual(snapshot.world_simulation?.[field]?.[key], value),
        `remount changed frozen world_simulation.${field}.${key}`,
      );
    }
  }
}

function stateUrl(baseUrl, actorId, actorSession) {
  const query = new URLSearchParams({
    actor_id: String(actorId),
    actor_session: actorSession,
  });
  return `${baseUrl}/state?${query}`;
}

function inspectUrl(baseUrl, actorId, actorSession) {
  const query = new URLSearchParams({
    actor_id: String(actorId),
    actor_session: actorSession,
  });
  return `${baseUrl}/inspect?${query}`;
}

async function fetchInspectableState(baseUrl, actorId, actorSession) {
  const [state, inspection] = await Promise.all([
    fetchJson(stateUrl(baseUrl, actorId, actorSession)),
    fetchJson(inspectUrl(baseUrl, actorId, actorSession)),
  ]);
  const internalActions = new Map(
    (inspection.actions || []).map((action) => [action.offer_id, action]),
  );
  return {
    ...state,
    action_offers: (state.action_offers || []).map((offer) => ({
      ...(internalActions.get(offer.offer_id) || {}),
      ...offer,
    })),
    action_hand: {
      ...(state.action_hand || {}),
      deck_size: (inspection.actions || []).length,
    },
    __inspection: inspection,
  };
}

async function waitForActorTurn(baseUrl, actorId, actorSession, description) {
  const deadline = Date.now() + 60_000;
  let state;
  while (Date.now() < deadline) {
    state = await fetchInspectableState(baseUrl, actorId, actorSession);
    if (!state.turn?.enabled || state.turn.is_current_actor) return state;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(
    `${description} never regained room initiative: ${JSON.stringify(state?.turn)}`,
  );
}

function inspectedRulesContext(state) {
  return (state?.__inspection?.actions || [])
    .map((action) => action.composition_trace?.rules_context)
    .find((context) => context !== undefined) ?? null;
}

function offerEnvelope(state, actorId, offerId) {
  return {
    world_id: state.world_id ?? "world://cosyworld/official",
    intent_id: `smoke:offer:${actorId}:${createHash("sha256").update(offerId).digest("hex")}`,
    actor_ref: state.command_context?.actor_ref ?? "",
    observed: {},
    last_world_seq: Number(state.world_seq ?? 0),
  };
}

function storyHandSlotForOffer(offer = {}) {
  const presentation = offer.presentation || {};
  const suit = String(presentation.suit || "");
  const sourceKind = String(presentation.source?.kind || offer.provider?.kind || "");
  const intention = String(offer.intention || "");
  const effect = String(offer.effect || "").toLowerCase();
  const hustleIsMovement = suit === "hustle" && (
    ["travel", "go", "cross", "return", "route", "routes"].includes(intention)
    || offer.kind === "move"
    || (offer.kind === "cast_spell" && /travel|move|return|cross|path/.test(effect))
  );
  if (offer.project || offer.risk || ["job", "location", "campaign"].includes(sourceKind)
      || suit === "honor" || hustleIsMovement) return "story";
  if (["journal", "friendship", "held_item", "calling"].includes(sourceKind)
      || suit === "heart") return "self";
  return "anchor";
}

async function passCurrentHand(baseUrl, actorId, actorSession, initialState, desiredSlot = "") {
  let state = initialState;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    state = await waitForActorTurn(
      baseUrl,
      actorId,
      actorSession,
      "Story Hand Think",
    );
    const thinkEntries = (state.action_hand?.entries || [])
      .filter((entry) => entry.think?.available && entry.think.offer_id)
      .sort((left, right) =>
        Number(left.think.generation ?? 0) - Number(right.think.generation ?? 0)
          || left.slot.localeCompare(right.slot));
    const pass = thinkEntries[0]?.think ?? state.action_hand?.pass;
    assert(pass?.offer_id, `a bounded deal must expose Think: ${JSON.stringify(state.action_hand)}`);
    const response = await fetch(`${baseUrl}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor_id: actorId,
        actor_session: actorSession,
        command: "think",
        offer_id: pass.offer_id,
        envelope: offerEnvelope(state, actorId, pass.offer_id),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const result = await response.json();
    if (response.ok && result.ok === true) return result;
    if ([409, 423].includes(response.status)) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      continue;
    }
    throw new Error(`Think failed while drawing an exact action: ${JSON.stringify(result)}`);
  }
  throw new Error("Think remained stale or turn-locked after five refreshed attempts");
}

async function drawExactOffer(
  baseUrl,
  actorId,
  actorSession,
  predicate,
  label,
) {
  let state = await waitForActorTurn(baseUrl, actorId, actorSession, label);
  const boundedThinks = Math.max(
    1,
    (Number(state.action_hand?.deck_size) || 1) * Number(state.action_hand?.capacity ?? 1),
  );
  for (let attempt = 0; attempt <= boundedThinks; attempt += 1) {
    const dealtIds = new Set((state.action_hand?.entries || []).map((entry) => entry.offer_id));
    const offer = (state.action_offers || []).find((candidate) =>
      dealtIds.has(candidate.offer_id) && predicate(candidate));
    if (offer) return offer;
    if (attempt === boundedThinks) break;
    await passCurrentHand(baseUrl, actorId, actorSession, state);
    state = await waitForActorTurn(baseUrl, actorId, actorSession, label);
  }
  throw new Error(`${label} was not dealt in one bounded rotation: ${JSON.stringify(state.action_hand)}`);
}

async function commandExactOffer(baseUrl, actorId, actorSession, value) {
  const normalized = String(value).trim().toLowerCase();
  const expectedKind = normalized === "search" ? "search" : null;
  const offer = await drawExactOffer(
    baseUrl,
    actorId,
    actorSession,
    (candidate) => {
      // The parser accepts bare `search`, while its certificate names the
      // concrete target. Select that exact certified action by kind.
      if (expectedKind) return candidate.kind === expectedKind;
      return String(candidate.command || "").trim().toLowerCase() === normalized;
    },
    `command ${value}`,
  );
  const result = await postJson(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    command: value,
    offer_id: offer.offer_id,
  });
  assert(result.ok === true, `${value} failed: ${JSON.stringify(result)}`);
  return result;
}

async function completeFirstTale(baseUrl, actorId, actorSession) {
  let state = await waitForActorTurn(baseUrl, actorId, actorSession, "first tale");
  for (let step = 0; step < 16 && state.first_tale?.phase !== "complete"; step += 1) {
    const offerId = state.first_tale?.advancing_offer_id;
    const handMatches = (state.action_hand?.entries || []).filter((entry) =>
      entry.offer_id === offerId);
    const offer = (state.action_offers || []).find((candidate) =>
      candidate.offer_id === offerId);
    assert(
      typeof offerId === "string" && offerId && handMatches.length === 1 && offer,
      `first tale step ${step + 1} did not expose one advancing card: ${JSON.stringify({
        first_tale: state.first_tale,
        action_hand: state.action_hand,
      })}`,
    );
    const result = await postJson(`${baseUrl}/commands`, {
      actor_id: actorId,
      actor_session: actorSession,
      command: offer.command,
      offer_id: offer.offer_id,
      envelope: offerEnvelope(state, actorId, offer.offer_id),
    });
    assert(
      result.ok === true,
      `first tale step ${step + 1} failed: ${JSON.stringify(result)}`,
    );
    state = await waitForActorTurn(baseUrl, actorId, actorSession, "first tale");
  }
  assert(
    state.first_tale?.phase === "complete" && state.location?.id === 2,
    `first tale did not finish in Rain-Soft Garden: ${JSON.stringify(state.first_tale)}`,
  );
  return state;
}

async function move(baseUrl, actorId, actorSession, destinationLocationId) {
  const offer = await drawExactOffer(
    baseUrl,
    actorId,
    actorSession,
    (candidate) => candidate.kind === "move" && Number(candidate.target?.id) === Number(destinationLocationId),
    `travel to ${destinationLocationId}`,
  );
  const result = await submitOffer(baseUrl, offer, "/actions/move", {
    actor_id: actorId,
    actor_session: actorSession,
    destination_location_id: destinationLocationId,
  });
  assert(
    result.ok === true,
    `move to ${destinationLocationId} failed: ${JSON.stringify(result)}`,
  );
  return result;
}

async function submitOffer(
  baseUrl,
  offer,
  path,
  payload,
  compositionId = offer.composition_id,
  expectedStatus,
) {
  const body = {
    path,
    offer_id: offer.offer_id,
    composition_id: compositionId,
    kind: offer.kind,
    rules_action: offer.rules_action,
    operation: offer.operation,
    rules_profile: offer.rules_profile,
    state_revision: offer.state_revision,
    route: offer.route,
    target: offer.target,
    cost: offer.cost,
    payload,
  };
  return expectedStatus === undefined
    ? postJson(`${baseUrl}/actions/submit`, body)
    : postJsonExpectingStatus(`${baseUrl}/actions/submit`, body, expectedStatus);
}

async function discoverExit(baseUrl, actorId, actorSession, destinationLocationId) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const state = await fetchInspectableState(baseUrl, actorId, actorSession);
    if (state.exits?.some((exit) =>
      exit.destination_location_id === destinationLocationId
      && exit.accessible === true
      && exit.locked === false)) {
      return state;
    }
    let scout;
    try {
      scout = await drawExactOffer(
        baseUrl,
        actorId,
        actorSession,
        (offer) => offer.kind === "explore_path"
          && Number(offer.target?.id) === Number(destinationLocationId),
        `Scout route to ${destinationLocationId}`,
      );
    } catch (error) {
      const refreshed = await fetchInspectableState(baseUrl, actorId, actorSession);
      if (refreshed.exits?.some((exit) =>
        exit.destination_location_id === destinationLocationId
        && exit.accessible === true
        && exit.locked === false)) {
        return refreshed;
      }
      throw error;
    }
    const submitted = await postJsonWithStatus(`${baseUrl}/commands`, {
      actor_id: actorId,
      actor_session: actorSession,
      command: scout.command,
      offer_id: scout.offer_id,
    });
    if ([409, 423].includes(submitted.status)) continue;
    const result = submitted.body;
    assert(
      submitted.status >= 200 && submitted.status < 300 && result.ok === true,
      `Scout route to ${destinationLocationId} failed: ${JSON.stringify(result)}`,
    );
  }
  throw new Error(`exit ${destinationLocationId} was not discovered after 32 Scout actions`);
}

async function assertContext(baseUrl, actorId, actorSession, state, {
  location,
  locationPack,
  selectedBy,
  capability,
  offerVerb,
  sourceCard,
}) {
  assert(state.location?.name === location, `expected ${location}: ${JSON.stringify(state.location)}`);
  const rulesContext = inspectedRulesContext(state);
  assert(
    rulesContext?.location_pack_id === locationPack
      && rulesContext?.selected_by_pack_id === selectedBy
      && rulesContext?.capability_id === capability,
    `wrong rules context at ${location}: ${JSON.stringify(rulesContext)}`,
  );
  const contextOffer = await drawExactOffer(
    baseUrl,
    actorId,
    actorSession,
    (offer) => offer.verb === offerVerb
      && offer.composition_trace?.source_card_instances?.some((card) => (
        card.card_id === sourceCard && card.pack_id === locationPack
      )),
    `${offerVerb} from ${sourceCard} at ${location}`,
  );
  assert(
    contextOffer.verb === offerVerb,
    `missing ${offerVerb} vocabulary at ${location}: ${JSON.stringify(contextOffer)}`,
  );
  assert(
    state.action_offers?.length > 0 && state.action_offers.every((offer) =>
      /^sha256:[0-9a-f]{64}$/.test(offer.composition_id)
      && /^sha256:[0-9a-f]{64}$/.test(offer.composition_trace?.worldpack_bundle_hash)
      && offer.composition_trace?.pack_versions?.some((pack) => pack.pack_id === locationPack)),
    `offers are missing composition certificates at ${location}`,
  );
}

async function main() {
  await access(binaryPath, constants.X_OK).catch(() => {
    throw new Error(`Missing orchestrator binary at ${binaryPath}. Build it before this smoke.`);
  });
  await access(coreOnlyRegistryPath, constants.R_OK);
  await access(coreRubyRegistryPath, constants.R_OK);
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-core-ruby-"));
  const snapshotPath = resolve(tempDir, "snapshot.json");
  const eventDbPath = resolve(tempDir, "events.sqlite");
  let source = null;
  let first = null;
  let second = null;
  let coreOnly = null;
  let remounted = null;
  let missingRubyRecordHash = null;

  try {
    source = await startServer(tempDir, coreOnlyRegistryPath, snapshotPath);
    assert(
      source.meta.worldpack?.id === "cosyworld.core-only",
      JSON.stringify(source.meta.worldpack),
    );
    const created = await postJson(`${source.baseUrl}/avatar`, {
      name: "Boundary Walker",
    });
    assert(created.ok && created.actor?.id && created.actor_session, JSON.stringify(created));
    const actorId = created.actor.id;
    const actorSession = created.actor_session;
    const sourceCottage = await fetchInspectableState(source.baseUrl, actorId, actorSession);
    await assertContext(source.baseUrl, actorId, actorSession, sourceCottage, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    assert(
      sourceCottage.action_offers?.every((offer) =>
        offer.composition_trace?.worldpack_bundle_hash
          === source.meta.worldpack.bundle_hash
          && offer.composition_trace?.pack_mount_revision === 0),
      "source offers did not bind the pre-mount composition",
    );
    await waitForActorJobs(eventDbPath);
    await stopServer(source.proc);
    source = null;

    const mounted = migratePack(
      "mount",
      snapshotPath,
      eventDbPath,
      coreOnlyRegistryPath,
      coreRubyRegistryPath,
    );
    assert(
      mounted.includes(
        '"mounted_pack_ids":["ruby-high.first-bell","cosyworld.composition.core-ruby"]',
      ),
      `cold mount transaction was not observable: ${mounted}`,
    );

    first = await startServer(tempDir, coreRubyRegistryPath, snapshotPath);
    assert(
      first.output.some((line) => line.includes("loaded journal checkpoint")),
      `cold mount restart did not use the journal checkpoint: ${first.output.slice(-40).join("")}`,
    );
    assert(first.meta.worldpack?.id === "cosyworld.core-ruby", JSON.stringify(first.meta.worldpack));
    assert(
      first.meta.worldpack?.packs?.map((pack) => pack.id).join(",")
        === [
          "cosyworld.rules-srd-5.2.1",
          "cosyworld.rules-profile-srd5",
          "cosyworld.core",
          "ruby-high.first-bell",
          "cosyworld.composition.core-ruby",
        ].join(","),
      `wrong mounted packs: ${JSON.stringify(first.meta.worldpack?.packs)}`,
    );

    const cottage = await fetchInspectableState(first.baseUrl, actorId, actorSession);
    await assertContext(first.baseUrl, actorId, actorSession, cottage, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    assert(
      cottage.action_offers?.every((offer) =>
        offer.composition_trace?.worldpack_bundle_hash
          === first.meta.worldpack.bundle_hash
          && offer.composition_trace?.pack_mount_revision === 1),
      "cold-mounted offers did not bind the committed composition revision",
    );
    await completeFirstTale(first.baseUrl, actorId, actorSession);
    await move(first.baseUrl, actorId, actorSession, 1);
    const discovered = await discoverExit(first.baseUrl, actorId, actorSession, 11);
    const travelOffer = await drawExactOffer(
      first.baseUrl,
      actorId,
      actorSession,
      (offer) => offer.kind === "move"
        && offer.verb === "Travel"
        && offer.target?.id === 11,
      "discovered Homeroom path did not become a Core Travel offer",
    );
    const travelPayload = {
      actor_id: actorId,
      actor_session: actorSession,
      destination_location_id: 11,
    };
    const rejectedTravel = await submitOffer(
      first.baseUrl,
      travelOffer,
      "/actions/move",
      travelPayload,
      `sha256:${"0".repeat(64)}`,
      409,
    );
    assert(
      rejectedTravel.ok === false
        && rejectedTravel.status === 409
        && rejectedTravel.events?.some((event) =>
          event.type === "action.offer_rejected"
          && event.content?.includes("scene composition changed")),
      `tampered composition certificate did not fail closed: ${JSON.stringify(rejectedTravel)}`,
    );
    const afterRejectedTravel = await fetchInspectableState(first.baseUrl, actorId, actorSession);
    assert(
      afterRejectedTravel.location?.id === cottage.location.id
        && afterRejectedTravel.world_seq === travelOffer.state_revision,
      `rejected composition certificate mutated the scene: ${JSON.stringify({
        before: { location: discovered.location, world_seq: travelOffer.state_revision },
        after: {
          location: afterRejectedTravel.location,
          world_seq: afterRejectedTravel.world_seq,
        },
      })}`,
    );
    const enteredRuby = await submitOffer(
      first.baseUrl,
      travelOffer,
      "/actions/move",
      travelPayload,
    );
    assert(enteredRuby.ok === true, `certified travel failed: ${JSON.stringify(enteredRuby)}`);
    const firstTransition = enteredRuby.events?.find(
      (event) => event.type === "rules_context.changed",
    );
    assert(firstTransition, `Core → Ruby transition missing: ${JSON.stringify(enteredRuby.events)}`);
    const transition = JSON.parse(firstTransition.content);
    assert(
      transition.from.selected_by_pack_id === "cosyworld.core"
        && transition.to.selected_by_pack_id === "ruby-high.first-bell",
      `wrong Core → Ruby transition: ${firstTransition.content}`,
    );

    const homeroom = await fetchInspectableState(first.baseUrl, actorId, actorSession);
    await assertContext(first.baseUrl, actorId, actorSession, homeroom, {
      location: "Homeroom",
      locationPack: "ruby-high.first-bell",
      selectedBy: "ruby-high.first-bell",
      capability: "ruby-high.first-bell/rules",
      offerVerb: "Notice",
      sourceCard: "location-homeroom",
    });
    const worldSeqBeforeRestart = homeroom.world_seq;

    await stopServer(first.proc);
    first = null;
    second = await startServer(tempDir, coreRubyRegistryPath, snapshotPath);
    assert(
      second.output.some((line) => line.includes("loaded journal checkpoint")),
      `restart did not use the journal checkpoint: ${second.output.slice(-40).join("")}`,
    );
    const replayed = await fetchInspectableState(second.baseUrl, actorId, actorSession);
    await assertContext(second.baseUrl, actorId, actorSession, replayed, {
      location: "Homeroom",
      locationPack: "ruby-high.first-bell",
      selectedBy: "ruby-high.first-bell",
      capability: "ruby-high.first-bell/rules",
      offerVerb: "Notice",
      sourceCard: "location-homeroom",
    });
    assert(
      replayed.world_seq >= worldSeqBeforeRestart,
      `journal replay regressed ${worldSeqBeforeRestart} to ${replayed.world_seq}`,
    );
    const replayQuery = new URLSearchParams({
      actor_id: String(actorId),
      actor_session: actorSession,
      limit: "500",
    });
    const replayEvents = await fetchJson(`${second.baseUrl}/events?${replayQuery}`);
    assert(
      replayEvents.events?.some((event) => event.type === "rules_context.changed"),
      `journal replay lost the current-room action loop: ${JSON.stringify(replayEvents.events)}`,
    );

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
    const returnedCore = await move(second.baseUrl, actorId, actorSession, 1);
    assert(
      returnedCore.events?.some((event) => event.type === "rules_context.changed"),
      `Ruby → Core transition missing: ${JSON.stringify(returnedCore.events)}`,
    );
    const returned = await fetchInspectableState(second.baseUrl, actorId, actorSession);
    await assertContext(second.baseUrl, actorId, actorSession, returned, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    await waitForActorJobs(eventDbPath);
    await stopServer(second.proc);
    second = null;

    const unmounted = migratePack(
      "unmount",
      snapshotPath,
      eventDbPath,
      coreRubyRegistryPath,
      coreOnlyRegistryPath,
    );
    assert(
      unmounted.startsWith("unmounted ruby-high.first-bell:"),
      `soft unmount transaction was not observable: ${unmounted}`,
    );
    const frozenSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert(
      frozenSnapshot.worldpack_bundle_hash
        === JSON.parse(await readFile(coreOnlyRegistryPath, "utf8")).manifest.bundle_hash,
      "soft unmount did not switch to the Core-only bundle",
    );
    const frozenRuby = frozenSnapshot.pack_mount_state?.frozen?.["ruby-high.first-bell"];
    assert(
      frozenRuby
        && frozenSnapshot.pack_mount_state.history.map(({ operation }) => operation).join(",")
          === "cold_mount,soft_unmount",
      `Ruby state was not frozen behind a committed lifecycle history: ${JSON.stringify(
        frozenSnapshot.pack_mount_state,
      )}`,
    );
    const degradedJournal = inspectJournal(eventDbPath, coreOnlyRegistryPath);
    const missingRubyRecord = degradedJournal.records.find((record) =>
      record.content_references?.some((reference) =>
        reference.canonical_ref === "pack://ruby-high.first-bell/location/11"
        && reference.status === "missing_pack"
        && reference.tombstone === true));
    assert(
      degradedJournal.summary.missing_pack_references > 0
        && missingRubyRecord
        && missingRubyRecord.replayable === false,
      `unmounted Ruby journal identity was not inspectable as a tombstone: ${JSON.stringify(
        degradedJournal.summary,
      )}`,
    );
    missingRubyRecordHash = missingRubyRecord.record_sha256;

    coreOnly = await startServer(tempDir, coreOnlyRegistryPath, snapshotPath);
    assert(
      coreOnly.output.some((line) => line.includes("loaded journal checkpoint")),
      `unmounted restart did not use the journal checkpoint: ${coreOnly.output.slice(-40).join("")}`,
    );
    assert(
      coreOnly.meta.worldpack?.id === "cosyworld.core-only"
        && !coreOnly.meta.worldpack?.packs?.some((pack) =>
          pack.id === "ruby-high.first-bell"
          || pack.id === "cosyworld.composition.core-ruby"),
      `Ruby or its bridge remained mounted: ${JSON.stringify(coreOnly.meta.worldpack)}`,
    );
    const whileUnmounted = await fetchInspectableState(coreOnly.baseUrl, actorId, actorSession);
    await assertContext(coreOnly.baseUrl, actorId, actorSession, whileUnmounted, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    assert(
      whileUnmounted.action_offers?.every((offer) =>
        offer.composition_trace?.worldpack_bundle_hash
          === coreOnly.meta.worldpack.bundle_hash
          && offer.composition_trace?.pack_mount_revision === 2),
      "unmounted offers did not bind the Core-only composition revision",
    );
    await waitForActorJobs(eventDbPath);
    await stopServer(coreOnly.proc);
    coreOnly = null;

    const restored = migratePack(
      "remount",
      snapshotPath,
      eventDbPath,
      coreOnlyRegistryPath,
      coreRubyRegistryPath,
    );
    assert(
      restored.startsWith("remounted ruby-high.first-bell:"),
      `remount transaction was not observable: ${restored}`,
    );
    const restoredSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert(
      Object.keys(restoredSnapshot.pack_mount_state?.frozen ?? {}).length === 0
        && restoredSnapshot.pack_mount_state.history.map(({ operation }) => operation).join(",")
          === "cold_mount,soft_unmount,remount",
      `Ruby state did not restore through one committed lifecycle: ${JSON.stringify(
        restoredSnapshot.pack_mount_state,
      )}`,
    );
    assertFrozenStateRestored(frozenRuby, restoredSnapshot);
    const restoredJournal = inspectJournal(eventDbPath, coreRubyRegistryPath);
    const restoredRubyRecord = restoredJournal.records.find((record) =>
      record.record_sha256 === missingRubyRecordHash
      && record.content_references?.some((reference) =>
        reference.canonical_ref === "pack://ruby-high.first-bell/location/11"
        && reference.status === "available"
        && reference.tombstone === undefined));
    assert(
      restoredJournal.summary.missing_pack_references === 0
        && restoredRubyRecord
        && restoredRubyRecord.replayable === true,
      `remounted Ruby journal identity did not restore unchanged: ${JSON.stringify(
        restoredJournal.summary,
      )}`,
    );

    remounted = await startServer(tempDir, coreRubyRegistryPath, snapshotPath);
    assert(
      remounted.output.some((line) => line.includes("loaded journal checkpoint")),
      `remounted restart did not use the journal checkpoint: ${remounted.output.slice(-40).join("")}`,
    );
    const afterRemount = await fetchInspectableState(remounted.baseUrl, actorId, actorSession);
    await assertContext(remounted.baseUrl, actorId, actorSession, afterRemount, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    assert(
      afterRemount.action_offers?.every((offer) =>
        offer.composition_trace?.worldpack_bundle_hash
          === remounted.meta.worldpack.bundle_hash
          && offer.composition_trace?.pack_mount_revision === 3),
      "remounted offers did not bind the restored composition revision",
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
    const restoredExit = await discoverExit(remounted.baseUrl, actorId, actorSession, 11);
    assert(
      restoredExit.exits?.some((exit) =>
        exit.destination_location_id === 11
        && exit.accessible === true
        && exit.locked === false),
      "remount did not restore the discovered Ruby bridge identity",
    );
    await move(remounted.baseUrl, actorId, actorSession, 11);
    const restoredHomeroom = await fetchInspectableState(remounted.baseUrl, actorId, actorSession);
    await assertContext(remounted.baseUrl, actorId, actorSession, restoredHomeroom, {
      location: "Homeroom",
      locationPack: "ruby-high.first-bell",
      selectedBy: "ruby-high.first-bell",
      capability: "ruby-high.first-bell/rules",
      offerVerb: "Notice",
      sourceCard: "location-homeroom",
    });
    console.log(JSON.stringify({
      ok: true,
      worldpack: remounted.meta.worldpack.id,
      packs: remounted.meta.worldpack.packs.map((pack) => pack.id),
      loop: [
        "The Cosy Cottage",
        "Homeroom",
        "journal checkpoint replay",
        "The Cosy Cottage",
        "Ruby High soft-unmounted",
        "Ruby journal tombstone inspected",
        "Core-only action",
        "Ruby High remounted",
        "Ruby journal reference restored",
        "Homeroom action",
      ],
    }, null, 2));
  } finally {
    if (source) await stopServer(source.proc);
    if (first) await stopServer(first.proc);
    if (second) await stopServer(second.proc);
    if (coreOnly) await stopServer(coreOnly.proc);
    if (remounted) await stopServer(remounted.proc);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
