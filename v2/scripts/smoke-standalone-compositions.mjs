#!/usr/bin/env node
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  },
  {
    label: "Bethlehem",
    registryPath: resolve(contentRoot, "bethlehem/registry.json"),
    entryLocationId: 700,
    worldpackId: "cosyworld.bethlehem",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
      "cosyworld.the-holy-land",
      "cosyworld.composition.core-holy-land",
      "cosyworld.lonely-forest.characters",
    ],
    location: "Bethlehem",
    locationPack: "cosyworld.the-holy-land",
    selectedBy: "cosyworld.core",
    capability: "cosyworld.core/rules",
    offerVerb: null,
    firstTaleAbsent: true,
    cardImagePath: "/assets/lonely-forest/characters/34-armored-winged-hero.png",
  },
  {
    label: "Lantern Keeper",
    registryPath: resolve(contentRoot, "lantern-keeper/registry.json"),
    entryLocationId: 800,
    worldpackId: "cosyworld.lantern-keeper",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
      "cosyworld.rules-srd-5.1",
      "cosyworld.campaign.the-lantern-keeper",
      "cosyworld.composition.core-lantern-keeper",
      "cosyworld.lonely-forest.characters",
    ],
    // Core card rows point at this pack's art, so the composition must mount it
    // or every character card degrades to the provider placeholder.
    cardImagePath: "/assets/lonely-forest/characters/29-grey-winged-boy.png",
    location: "The Cosy Cottage",
    locationPack: "cosyworld.core",
    selectedBy: "cosyworld.core",
    capability: "cosyworld.core/rules",
    offerVerb: null,
    firstTaleQuestionIncludes: "washed garden path",
    characterCreation: {
      character_creation_id: "the-lantern-keeper",
      species_id: "human",
      origin_id: "old-chapel",
    },
    goldenJourney: true,
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
    offerVerb: "Notice",
    firstTaleAbsent: true,
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
  },
  {
    label: "Elysium",
    registryPath: resolve(contentRoot, "elysium-only/registry.json"),
    worldpackId: "cosyworld.elysium",
    packIds: [
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.elysium",
    ],
    location: "Void 001",
    locationPack: "cosyworld.elysium",
    selectedBy: "cosyworld.elysium",
    capability: "cosyworld.rules-profile-srd5/rules",
    offerVerb: "Scout",
    firstTaleAbsent: true,
    seedActorCount: 500,
    seedItemCount: 500,
    seedLocationCount: 500,
    localSeedActorCount: 1,
    localSeedActorControlMode: "local_ai",
    localItemCount: 1,
    noticeAbsent: true,
    scoutDestination: "Void 002",
    additionalScoutDestination: "Void 003",
    multiStepScoutPath: true,
    connectionItem: "Void Token 001",
    legacyGeneratedCheckpoint: {
      bundleHash: "sha256:3cfea1b17307d8c65fa904f612ca25f01c805a892647ecd54ff03c816a0041ee",
      packVersion: "0.2.0",
    },
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function routeDiscoveryEvent(event) {
  return event.type === "exit.discovered" || event.type === "pathway.discovered";
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

async function fetchJson(url, init, timeoutMs = 5_000) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  assert(response.ok, `${url} returned HTTP ${response.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

async function postJson(url, body, timeoutMs) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
}

async function postJsonWithStatus(url, body, timeoutMs = 5_000) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

async function postJsonExpectingStatus(url, body, expectedStatus, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? 5_000),
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

async function startServer(
  tempDir,
  registryPath,
  entryLocationId,
  { production = false } = {},
) {
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
    COSYWORLD_DEPLOY_PROFILE: production ? "production" : "local",
    RUST_LOG: "cosyworld_orchestrator=info",
    COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
    COSYWORLD_DISABLE_CTRL_C_SHUTDOWN: "1",
    COSYWORLD_CANONICAL_LEASE_TTL_MS: "1000",
    COSYWORLD_V2_SNAPSHOT_PATH: resolve(tempDir, "snapshot.json"),
    COSYWORLD_V2_EVENT_DB_PATH: resolve(tempDir, "events.sqlite"),
    COSYWORLD_V2_GENERATED_ASSET_DIR: resolve(tempDir, "generated"),
  });
  if (production) {
    env.COSYWORLD_MODERATION_TOKEN = "standalone-composition-smoke";
    env.COSYWORLD_WEBAUTHN_RP_ID = "localhost";
    env.COSYWORLD_WEBAUTHN_ORIGIN = `http://localhost:${port}`;
    delete env.COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS;
  } else {
    env.COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS = "0";
  }
  if (entryLocationId) {
    env.COSYWORLD_ENTRY_LOCATION_ID = String(entryLocationId);
  } else {
    delete env.COSYWORLD_ENTRY_LOCATION_ID;
  }
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

async function rewriteElysiumCheckpointAsProductionLegacy(tempDir, legacy) {
  const snapshotPath = resolve(tempDir, "snapshot.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const legacyBinding = {
    schema_version: 1,
    policy_id: "cosyworld.compatibility.host-generation/1",
    migration_version: 0,
    collision_namespace: "",
    owner_pack_id: "cosyworld.elysium",
    owner_pack_version: legacy.packVersion,
    composition_id: "cosyworld.elysium",
    composition_bundle_hash: legacy.bundleHash,
    prose_profile_id: "",
    prose_prompt_version: "",
    ecology_transition: "",
    topology_profile_id: "",
    unmount_behavior: "host_default",
  };
  let rewrittenBindings = 0;

  function rewrite(value) {
    if (Array.isArray(value)) {
      for (const entry of value) rewrite(entry);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.generation_policy?.owner_pack_id === "cosyworld.elysium") {
      value.generation_policy = { ...legacyBinding };
      rewrittenBindings += 1;
    }
    if (value.owner_pack_id === "cosyworld.elysium" && "owner_pack_version" in value) {
      value.owner_pack_version = legacy.packVersion;
    }
    if (value.pack_id === "cosyworld.elysium" && "pack_version" in value) {
      value.pack_version = legacy.packVersion;
    }
    if (value.provider_pack_id === "cosyworld.elysium" && "provider_pack_version" in value) {
      value.provider_pack_version = legacy.packVersion;
    }
    if (value.id === "cosyworld.elysium" && value.version === "0.2.2") {
      value.version = legacy.packVersion;
    }
    for (const entry of Object.values(value)) rewrite(entry);
  }

  snapshot.worldpack_bundle_hash = legacy.bundleHash;
  rewrite(snapshot);
  assert(
    rewrittenBindings >= 3,
    `Elysium historical checkpoint rewrote only ${rewrittenBindings} generated policy bindings`,
  );
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
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

async function fetchAllActorEvents(baseUrl, actorId, actorSession) {
  const events = [];
  let after = 0;
  const maxPages = 10;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const query = new URLSearchParams({
      actor_id: String(actorId),
      actor_session: actorSession,
      after: String(after),
      limit: "500",
    });
    const page = await fetchJson(`${baseUrl}/events?${query}`);
    events.push(...(page.events || []));
    if (page.caught_up) return events;
    assert(
      Number(page.next_after) > after,
      `Event replay stalled at ${after}: ${JSON.stringify(page)}`,
    );
    after = Number(page.next_after);
  }
  throw new Error(`Event replay exceeded ${maxPages} pages before catching up`);
}

function readDurableWorldEvents(eventDbPath) {
  const database = new Database(eventDbPath, { readonly: true, fileMustExist: true });
  try {
    return database
      .prepare("SELECT payload_json FROM world_events ORDER BY seq ASC")
      .all()
      .map(({ payload_json: payload }) => JSON.parse(payload));
  } finally {
    database.close();
  }
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

function thinkForSlot(state, slot = "") {
  const entries = state.action_hand?.entries || [];
  return entries.find((entry) => entry.slot === slot && entry.think?.available)?.think
    || entries.find((entry) => entry.think?.available)?.think;
}

async function dealOffer(baseUrl, actorId, actorSession, predicate, description) {
  let state;
  let offer;
  let passAttempts = 0;
  let maxPassAttempts = 0;
  let stalePassRefreshes = 0;
  const maxStalePassRefreshes = 4;
  const maxTurnLockedPassRefreshes = 2;
  let turnLockedPassRefreshes = 0;
  const maxWriteAuthorityRefreshes = 12;
  let writeAuthorityRefreshes = 0;
  while (true) {
    state = await waitForActorTurn(baseUrl, actorId, actorSession, description);
    offer = state.action_offers?.find(
      (candidate) => !candidate.disabled && predicate(candidate),
    );
    if (offer) break;
    if (
      passAttempts > 0 &&
      !state.__inspection?.actions?.some(
        (candidate) => !candidate.disabled && predicate(candidate),
      )
    ) {
      break;
    }
    if (maxPassAttempts === 0) {
      maxPassAttempts = Math.max(
        1,
        Number(state.action_hand?.deck_size ?? 0) * Number(state.action_hand?.capacity ?? 1),
      );
    }
    if (passAttempts >= maxPassAttempts) break;
    const thinkEntries = (state.action_hand?.entries || [])
      .filter((entry) => entry.think?.available && entry.think.offer_id)
      .sort((left, right) =>
        Number(left.think.generation ?? 0) - Number(right.think.generation ?? 0)
          || left.slot.localeCompare(right.slot));
    const passOffer = thinkEntries[0]?.think ?? state.action_hand?.pass;
    assert(
      passOffer?.offer_id,
      `No dealt card matches ${description} and Think is unavailable: ${JSON.stringify(state.action_hand)}`,
    );
    const passPayload = {
      actor_id: actorId,
      actor_session: actorSession,
      command: "think",
      offer_id: passOffer.offer_id,
      envelope: offerEnvelope(state, actorId, passOffer.offer_id),
    };
    const passed = await postJsonWithStatus(`${baseUrl}/commands`, passPayload);
    if (passed.status === 409 && stalePassRefreshes++ < maxStalePassRefreshes) continue;
    if (passed.status === 423 && turnLockedPassRefreshes++ < maxTurnLockedPassRefreshes) continue;
    if (passed.status === 503
      && passed.body.output?.includes("Canonical write authority is unavailable")
      && writeAuthorityRefreshes++ < maxWriteAuthorityRefreshes) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      continue;
    }
    assert(passed.status >= 200 && passed.status < 300 && passed.body.ok === true,
      `Think failed while seeking ${description}: ${JSON.stringify(passed)}`);
    passAttempts += 1;
  }
  assert(
    offer?.offer_id,
    `The finite hand did not deal ${description} within ${maxPassAttempts} Thinks: ${JSON.stringify({
      hand: state?.action_hand,
      offers: state?.action_offers?.map(({ kind, command, label, project, provider, target }) => ({
        kind,
        command,
        label,
        project,
        provider,
        target,
      })),
      firstTale: state?.first_tale,
      questions: state?.shared_questions?.map(({ id, strategies }) => ({
        id,
        strategies: strategies?.map(({ id: strategyId, available, availability_reason }) => ({
          id: strategyId,
          available,
          availability_reason,
        })),
      })),
    })}`,
  );
  return { state, offer };
}

async function command(baseUrl, actorId, actorSession, value) {
  const usesRawCommand =
    /^(wield|unwield|prepare-spell|unprepare-spell|stow|unstow)\b/i.test(value);
  const requestedKind = value.trim().toLowerCase();
  const matchesRequestedOffer = (candidate) =>
    candidate.command === value
      || (requestedKind === "search" && candidate.kind === "search")
      || (requestedKind === "bond mara wick" && candidate.kind === "create_bond" && candidate.target?.id === 8301);
  const maxRedeals = 4;
  let staleRedeals = 0;
  let turnLockedRedeals = 0;
  while (true) {
    const dealt = usesRawCommand
      ? { state: await waitForActorTurn(baseUrl, actorId, actorSession, value) }
      : await dealOffer(
          baseUrl,
          actorId,
          actorSession,
          matchesRequestedOffer,
          value,
        );
    const payload = {
      actor_id: actorId,
      actor_session: actorSession,
      command: dealt.offer?.command ?? value,
      ...(dealt.offer && {
        offer_id: dealt.offer.offer_id,
        envelope: offerEnvelope(dealt.state, actorId, dealt.offer.offer_id),
      }),
    };
    const submitted = await postJsonWithStatus(`${baseUrl}/commands`, payload);
    if (
      !usesRawCommand &&
      submitted.status === 409 &&
      staleRedeals++ < maxRedeals
    )
      continue;
    if (submitted.status === 423 && turnLockedRedeals++ < 2) continue;
    const result = submitted.body;
    assert(result.ok === true, `${value} failed: ${JSON.stringify(result)}`);
    return result;
  }
}

async function passCurrentHand(baseUrl, actorId, actorSession) {
  const state = await waitForActorTurn(
    baseUrl,
    actorId,
    actorSession,
    "replay-marker Think",
  );
  const thinkEntries = (state.action_hand?.entries || [])
    .filter((entry) => entry.think?.available && entry.think.offer_id)
    .sort((left, right) =>
      Number(left.think.generation ?? 0) - Number(right.think.generation ?? 0)
        || left.slot.localeCompare(right.slot));
  const passOffer = thinkEntries[0]?.think ?? state.action_hand?.pass;
  assert(passOffer?.offer_id, `a bounded deal must expose Think: ${JSON.stringify(state.action_hand)}`);
  const passed = await postJsonWithStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    command: "think",
    offer_id: passOffer.offer_id,
    envelope: offerEnvelope(state, actorId, passOffer.offer_id),
  });
  assert(
    passed.status >= 200 && passed.status < 300 && passed.body.ok === true,
    `Think failed while committing the replay marker: ${JSON.stringify(passed)}`,
  );
  return passed.body;
}

async function ensureScoutedRoute(
  baseUrl,
  actorId,
  actorSession,
  destinationId,
  destinationName,
) {
  const routeIsAvailable = (state) => state.__inspection?.actions?.some(
    (offer) =>
      offer.kind === "move" &&
      Number(offer.target?.id) === Number(destinationId),
  );
  let state = await fetchInspectableState(baseUrl, actorId, actorSession);
  if (routeIsAvailable(state)) return;
  let scouted;
  try {
    scouted = await command(
      baseUrl,
      actorId,
      actorSession,
      `scout ${destinationName}`,
    );
  } catch (error) {
    state = await fetchInspectableState(baseUrl, actorId, actorSession);
    if (routeIsAvailable(state)) return;
    throw error;
  }
  assert(
    scouted.events?.filter(routeDiscoveryEvent).length === 1,
    `The room did not reveal the route to ${destinationName} exactly once: ${JSON.stringify(scouted)}`,
  );
}

async function commitReplayMarker(baseUrl, actorId, actorSession) {
  const state = await waitForActorTurn(
    baseUrl,
    actorId,
    actorSession,
    "replay marker",
  );
  if (
    (state.action_hand?.entries || []).some((entry) => entry.think?.available)
  ) {
    return passCurrentHand(baseUrl, actorId, actorSession);
  }
  const dealtIds = new Set((state.action_hand?.entries || []).map((entry) => entry.offer_id));
  const offer = (state.action_offers || []).find((candidate) => (
    !candidate.disabled && dealtIds.has(candidate.offer_id)
  ));
  assert(offer?.offer_id && offer.command, `a non-replaceable Story Hand must remain playable: ${JSON.stringify(state.action_hand)}`);
  const played = await postJsonWithStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    command: offer.command,
    offer_id: offer.offer_id,
    envelope: offerEnvelope(state, actorId, offer.offer_id),
  });
  assert(
    played.status >= 200 && played.status < 300 && played.body.ok === true,
    `the non-replaceable Story Hand action failed while committing the replay marker: ${JSON.stringify(played)}`,
  );
  return played.body;
}

function lanternJourneySummary(state) {
  return {
    location: state.location?.name,
    level: state.character_identity?.level,
    identity: state.character_identity,
    actors: state.actors?.map(({ id, name }) => ({ id, name })),
    items: state.items?.map(({ id, name }) => ({ id, name })),
    offers: state.action_offers?.map(({ kind, command, target, disabled }) => ({
      kind,
      command,
      target,
      disabled,
    })),
    combat: state.combat,
    shared_questions: state.shared_questions,
  };
}

function traceLantern(label, state) {
  assertLanternSuggestions(state, label);
  if (process.env.COSYWORLD_COMPOSITION_SMOKE_TRACE !== "1") return;
  const filter = process.env.COSYWORLD_COMPOSITION_SMOKE_TRACE_LABEL;
  if (filter && !label.includes(filter)) return;
  console.error(`${label}: ${JSON.stringify(lanternJourneySummary(state), null, 2)}`);
}

function assertLanternSuggestions(state, label) {
  const question = state.shared_questions?.find((candidate) =>
    candidate.id === "lantern-keeper:rekindle-the-beacon");
  assert(question, `${label} lost the Lantern Keeper shared question`);
  if (question.presentation_state !== "active") return;
  const suggestions = state.action_offers || [];
  assert(
    suggestions.length === 3
      && suggestions.every((suggestion) =>
        suggestion.offer_id
          && suggestion.accessible_label
          && (suggestion.target?.label || suggestion.project?.label || state.location?.name)
          && suggestion.provider?.id
          && suggestion.effect)
      && Number.isFinite(Number(question.filled))
      && Number.isFinite(Number(question.danger_filled)),
    `${label} did not expose exactly three accessible truthful suggestions: ${JSON.stringify({
      suggestions,
      question,
    })}`,
  );
}

function firstTaleAdvancingOffer(state, label) {
  const offerId = state.first_tale?.advancing_offer_id
    ?? state.first_tale?.continuation?.advancing_offer_id;
  const handMatches = state.action_hand?.entries?.filter((entry) =>
    entry.offer_id === offerId) ?? [];
  const offer = state.action_offers?.find((candidate) => candidate.offer_id === offerId);
  assert(
    typeof offerId === "string" && offerId && handMatches.length === 1 && offer,
    `${label} did not guarantee exactly one certified advancing First Tale card: ${JSON.stringify({
      first_tale: state.first_tale,
      hand: state.action_hand,
      offers: state.action_offers?.map(({ offer_id, kind, command }) => ({ offer_id, kind, command })),
    })}`,
  );
  return offer;
}

async function beginLanternGoldenJourney(baseUrl, actorId, actorSession, initial) {
  assert(
    initial.character_identity?.level === 0
      && initial.character_identity?.class_id == null
      && initial.character_identity?.class_selection_ready === false,
    `Lantern Keeper did not begin classless at level 0: ${JSON.stringify(lanternJourneySummary(initial))}`,
  );
  assert(
    initial.location?.id === 1
      && initial.first_tale?.phase === "notice"
      && initial.first_tale?.lead_location_id === 1
      && initial.first_tale?.destination_location_id === 2
      && initial.first_tale?.job_id === "rain-soft-garden:trustworthy-path"
      && initial.first_tale?.progress_clock_id === "rain-soft-garden.trustworthy-path"
      && /^ftx_[0-9a-f]{16}$/.test(initial.first_tale?.phase_exposure_id ?? "")
      && initial.first_tale?.state_revision === initial.state_revision,
    `Lantern Keeper did not expose the server-authored Cottage tale authority: ${JSON.stringify(initial.first_tale)}`,
  );
  const noticeOffer = firstTaleAdvancingOffer(initial, "lantern Cottage notice");
  const listened = await command(baseUrl, actorId, actorSession, noticeOffer.command);
  assert(
    listened.events?.some((event) => event.type === "notice.actor_observed")
      && listened.events?.some((event) => event.type === "notice.fact_revealed"),
    `Lantern Keeper Cottage Notice did not reveal its first useful lead: ${JSON.stringify(listened)}`,
  );

  let taleState = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    taleState.first_tale?.phase === "follow_lead"
      && taleState.first_tale?.required_location_id === 2,
    `Lantern Keeper did not retain its Garden lead after Notice: ${JSON.stringify(taleState.first_tale)}`,
  );
  for (let step = 0; step < 4 && taleState.first_tale?.phase !== "contribute"; step += 1) {
    const offer = firstTaleAdvancingOffer(taleState, `lantern Garden step ${step + 1}`);
    await command(baseUrl, actorId, actorSession, offer.command);
    taleState = await fetchInspectableState(baseUrl, actorId, actorSession);
  }
  assert(
    taleState.location?.id === 2 && taleState.first_tale?.phase === "contribute",
    `Lantern Keeper did not reach the authored Garden contribution: ${JSON.stringify(taleState.first_tale)}`,
  );
  let firstContribution = null;
  for (let step = 0; step < 8 && firstContribution === null; step += 1) {
    const offer = firstTaleAdvancingOffer(taleState, `lantern Garden contribution step ${step + 1}`);
    const result = await command(baseUrl, actorId, actorSession, offer.command);
    if (result.events?.some((event) => event.type === "job.contribution.resolved")) {
      firstContribution = result;
    } else {
      taleState = await fetchInspectableState(baseUrl, actorId, actorSession);
    }
  }
  const contributionEvent = firstContribution?.events?.find((event) =>
    event.type === "job.contribution.resolved");
  const traceEvents = firstContribution?.events?.filter((event) =>
    event.type === "first_tale.public_trace") ?? [];
  assert(
    contributionEvent
      && traceEvents.length === 1
      && traceEvents[0].caused_by_event_seq === contributionEvent.seq
      && firstContribution.events?.some((event) => event.type === "ledger.banked"),
    `Lantern Keeper first contribution did not emit one replay-safe trace and settle its reward: ${JSON.stringify(firstContribution)}`,
  );
  taleState = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    taleState.first_tale?.phase === "complete"
      && taleState.first_tale?.continuation?.destination_location_id === 800
      && taleState.first_tale?.continuation?.target_actor_id === 8301
      && taleState.first_tale?.continuation?.phase === "travel",
    `Lantern Keeper completion did not expose its structured Lantern continuation: ${JSON.stringify(taleState.first_tale)}`,
  );
  assert(
    taleState.character_identity?.class_selection_ready === true
      && taleState.character_identity?.class_recommendation?.class_id === "lantern-warden",
    `Lantern Keeper first contribution did not freeze its authored Class evidence: ${JSON.stringify(lanternJourneySummary(taleState))}`,
  );

  const chosen = await postJson(`${baseUrl}/avatar/class`, {
    actor_id: actorId,
    actor_session: actorSession,
    character_creation_id: "the-lantern-keeper",
    class_id: "lantern-warden",
  });
  assert(
    chosen.ok === true && chosen.events?.filter((event) => event.type === "class.chosen").length === 1,
    `Lantern Keeper Class selection did not commit exactly once: ${JSON.stringify(chosen)}`,
  );
  const duplicate = await postJsonExpectingStatus(`${baseUrl}/avatar/class`, {
    actor_id: actorId,
    actor_session: actorSession,
    character_creation_id: "the-lantern-keeper",
    class_id: "lantern-warden",
  }, 409);
  assert(
    duplicate.ok === false && duplicate.status === 409,
    `Lantern Keeper allowed Class selection to be replayed: ${JSON.stringify(duplicate)}`,
  );
  const classed = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    classed.character_identity?.level === 1
      && classed.character_identity?.class_id === "lantern-warden"
      && classed.character_identity?.class_selection_ready === false,
    `Lantern Keeper Class choice did not produce one level-1 avatar: ${JSON.stringify(lanternJourneySummary(classed))}`,
  );
  taleState = classed;
  for (let step = 0; step < 8 && taleState.location?.id !== 800; step += 1) {
    const offer = firstTaleAdvancingOffer(taleState, `lantern continuation step ${step + 1}`);
    await command(baseUrl, actorId, actorSession, offer.command);
    taleState = await fetchInspectableState(baseUrl, actorId, actorSession);
  }
  assert(
    taleState.location?.id === 800
      && taleState.first_tale?.continuation?.phase === "arrived",
    `Lantern Keeper did not reach Mara through the server-authored continuation: ${JSON.stringify(lanternJourneySummary(taleState))}`,
  );
  traceLantern("lantern arrival", taleState);

  const maraOffer = firstTaleAdvancingOffer(taleState, "lantern Mara continuation");
  assert(
    maraOffer.kind === "create_bond" && maraOffer.target?.id === 8301,
    `Lantern continuation did not certify Mara's exact relationship offer: ${JSON.stringify(maraOffer)}`,
  );
  const metMara = await command(baseUrl, actorId, actorSession, maraOffer.command);
  assert(
    metMara.events?.filter((event) => event.type === "bond.created").length === 1
      && metMara.events?.filter((event) => event.type === "relationship.beat").length === 1
      && metMara.events?.some((event) =>
        event.type === "relationship.beat" && event.content?.includes("empty key hook")),
    `Lantern Keeper did not commit Mara's corrected authored relationship beat: ${JSON.stringify(metMara)}`,
  );
  const acceptedMara = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    acceptedMara.first_tale?.continuation?.phase === "accepted"
      && acceptedMara.first_tale?.continuation?.target_actor_id === 8301
      && acceptedMara.first_tale?.continuation?.instruction?.includes("dark-road lead")
      && acceptedMara.first_tale?.advancing_offer_id == null,
    `Lantern continuation did not settle after Mara's active bond: ${JSON.stringify(acceptedMara.first_tale)}`,
  );

  const searchedFailingLantern = await command(baseUrl, actorId, actorSession, "search");
  assert(
    searchedFailingLantern.events?.some((event) =>
      event.type === "feature.searched"
        && event.location_id === 800
        && event.content?.includes("gone north")),
    `Lantern Keeper did not follow Mara's failing-lantern clue: ${JSON.stringify(searchedFailingLantern)}`,
  );

  const tookCampKit = await command(baseUrl, actorId, actorSession, "take Keeper's Camp Kit");
  assert(
    tookCampKit.events?.filter((event) =>
      event.type === "item.picked_up" && event.item_id === 8405).length === 1,
    `Lantern Keeper did not acquire the authored camp shelter: ${JSON.stringify(tookCampKit)}`,
  );
  const equippedCampKit = await command(
    baseUrl,
    actorId,
    actorSession,
    "wield Keeper's Camp Kit",
  );
  assert(
    equippedCampKit.events?.filter((event) =>
      event.type === "item.equipped" && event.item_id === 8405).length === 1,
    `Lantern Keeper could not equip its public camp-shelter tool: ${JSON.stringify(equippedCampKit)}`,
  );

  await ensureScoutedRoute(
    baseUrl,
    actorId,
    actorSession,
    801,
    "Mothwood Path",
  );
  await command(baseUrl, actorId, actorSession, "go Mothwood Path");
  const mothwood = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    mothwood.location?.id === 801 && mothwood.location?.name === "Mothwood Path",
    `Lantern Keeper did not reach Mothwood through legal travel: ${JSON.stringify(lanternJourneySummary(mothwood))}`,
  );
  traceLantern("lantern Mothwood", mothwood);

  const tookLens = await command(baseUrl, actorId, actorSession, "take Mothglass Lens");
  assert(
    tookLens.events?.filter((event) => event.type === "item.picked_up" && event.item_id === 8402).length === 1,
    `Lantern Keeper did not acquire the authored Mothglass Lens: ${JSON.stringify(tookLens)}`,
  );
  const placedLens = await command(
    baseUrl,
    actorId,
    actorSession,
    "use Mothglass Lens on Cold Lamp Post",
  );
  assert(
    placedLens.events?.some((event) => event.type === "item.used" && event.item_id === 8402),
    `Lantern Keeper did not use Mothwood evidence on its authored feature: ${JSON.stringify(placedLens)}`,
  );
  await ensureScoutedRoute(
    baseUrl,
    actorId,
    actorSession,
    802,
    "Saint Orra's Ruin",
  );
  await command(baseUrl, actorId, actorSession, "go Saint Orra's Ruin");
  const saintOrra = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    saintOrra.location?.id === 802
      && saintOrra.items?.some((item) => item.id === 8401 && item.name === "Keeper's Brass Key")
      && !saintOrra.action_offers?.some((offer) =>
        matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon")),
    `Lantern Keeper did not reach Saint Orra with the shortcut still closed: ${JSON.stringify(lanternJourneySummary(saintOrra))}`,
  );
  const shortcut = await postJsonExpectingStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    command: "work",
  }, 409);
  assert(
    shortcut.ok === false && shortcut.events?.length === 0,
    `Lantern Keeper accepted the Saint Orra finale shortcut: ${JSON.stringify(shortcut)}`,
  );
  traceLantern("lantern Saint Orra", saintOrra);

  const tookKey = await command(baseUrl, actorId, actorSession, "take Keeper's Brass Key");
  assert(
    tookKey.events?.filter((event) => event.type === "item.picked_up" && event.item_id === 8401).length === 1,
    `Lantern Keeper did not acquire the authored Brass Key: ${JSON.stringify(tookKey)}`,
  );
  const turnedKey = await command(
    baseUrl,
    actorId,
    actorSession,
    "use Keeper's Brass Key on Stone Lantern",
  );
  assert(
    turnedKey.events?.some((event) => event.type === "item.used" && event.item_id === 8401),
    `Lantern Keeper did not use Saint Orra evidence on its authored feature: ${JSON.stringify(turnedKey)}`,
  );
  await ensureScoutedRoute(
    baseUrl,
    actorId,
    actorSession,
    803,
    "Flooded Barrow",
  );
  await command(baseUrl, actorId, actorSession, "go Flooded Barrow");
  const barrow = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    barrow.location?.id === 803
      && barrow.location?.name === "Flooded Barrow"
      && barrow.actors?.some((actor) => actor.id === 8303 && actor.name === "Moth-Eaten Knight"),
    `Lantern Keeper did not reach the authored Barrow encounter: ${JSON.stringify(lanternJourneySummary(barrow))}`,
  );
  traceLantern("lantern Flooded Barrow arrival", barrow);

  const tookOil = await command(baseUrl, actorId, actorSession, "take Dawn Oil");
  assert(
    tookOil.events?.filter((event) => event.type === "item.picked_up" && event.item_id === 8403).length === 1,
    `Lantern Keeper did not acquire the authored Dawn Oil: ${JSON.stringify(tookOil)}`,
  );
  const litOil = await command(baseUrl, actorId, actorSession, "use Dawn Oil on Golden Oil Slick");
  assert(
    litOil.events?.filter((event) => event.type === "item.used" && event.item_id === 8403).length === 1
      && litOil.events?.filter((event) =>
        event.type === "combat.encounter.resolved"
          && event.target_actor_id === 8303
          && event.success === true
          && event.total === 1).length === 1,
    `Lantern Keeper did not resolve the Barrow through its authored Dawn Oil choice: ${JSON.stringify(litOil)}`,
  );
  const barrowResolved = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    !barrowResolved.combat
      && !barrowResolved.action_offers?.some((offer) => offer.kind === "attack"),
    `Lantern Keeper's authored nonviolent Barrow resolution left a combat behind: ${JSON.stringify(lanternJourneySummary(barrowResolved))}`,
  );
  traceLantern("lantern Flooded Barrow resolved", barrowResolved);

  await ensureScoutedRoute(
    baseUrl,
    actorId,
    actorSession,
    804,
    "Lantern Tower",
  );
  await command(baseUrl, actorId, actorSession, "go Lantern Tower");
  const tower = await fetchInspectableState(baseUrl, actorId, actorSession);
  assert(
    tower.location?.id === 804
      && tower.location?.name === "Lantern Tower"
      && tower.items?.some((item) => item.id === 8404 && item.name === "Keeper's Ember")
      && !tower.action_offers?.some((offer) =>
        matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon")),
    `Lantern Keeper reached the Tower without the remaining finale prerequisites closed: ${JSON.stringify(lanternJourneySummary(tower))}`,
  );
  await command(baseUrl, actorId, actorSession, "take Keeper's Ember");
  for (const itemName of [
    "Keeper's Brass Key",
    "Mothglass Lens",
    "Dawn Oil",
    "Keeper's Ember",
  ]) {
    const assembled = await command(
      baseUrl,
      actorId,
      actorSession,
      `use ${itemName} on Great Lantern Lens`,
    );
    assert(
      assembled.events?.some((event) => event.type === "item.used"),
      `Lantern Keeper could not fit ${itemName} into the Great Lantern Lens: ${JSON.stringify(assembled)}`,
    );
  }
  let towerReady = await fetchInspectableState(baseUrl, actorId, actorSession);
  if (towerReady.tags?.some((tag) => tag.tag_label === "tired" || tag.label === "tired")) {
    await dealOffer(
      baseUrl,
      actorId,
      actorSession,
      (offer) => offer.kind === "rest",
      "the pre-finale recovery Rest card",
    );
    const recovered = await command(baseUrl, actorId, actorSession, "rest");
    assert(
      recovered.events?.some((event) =>
        event.type === "tag.cleared" && event.tag_label === "tired"),
      `Lantern Keeper could not recover before the finale authority check: ${JSON.stringify(recovered)}`,
    );
    towerReady = await fetchInspectableState(baseUrl, actorId, actorSession);
  }
  const earlyCompletedQuestion = towerReady.shared_questions?.find(
    (question) => question.id === "lantern-keeper:rekindle-the-beacon",
  );
  const autonomousFinale =
    earlyCompletedQuestion?.presentation_state === "completed_memory";
  const dangerBeforeFinale = Number(earlyCompletedQuestion?.danger_filled || 0);
  let finalePayload = null;
  let finale = null;
  const beforeFinaleOrbs = towerReady.economy?.orbs;
  if (autonomousFinale) {
    const events = await fetchAllActorEvents(baseUrl, actorId, actorSession);
    assert(
      events.filter(
        (event) =>
          event.type === "job.contribution.resolved" &&
          event.actor_id === 8304 &&
          event.content?.includes("lantern-keeper:rekindle-the-beacon"),
      ).length === 1,
      `Rowan's autonomous finale was not committed exactly once: ${JSON.stringify(earlyCompletedQuestion)}`,
    );
  } else {
    const initialWorkDeal = await dealOffer(
      baseUrl,
      actorId,
      actorSession,
      (offer) =>
        offer.kind === "work" &&
        matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"),
      "the finale Work card",
    );
    towerReady = initialWorkDeal.state;
    const initialWorkOffer = initialWorkDeal.offer;
    assert(
      initialWorkOffer?.offer_id &&
        initialWorkOffer?.command === "contribute rekindle-beacon",
      `Lantern Keeper did not expose the authoritative finale offer: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
    );
    traceLantern("lantern Tower ready", towerReady);

    const tamperedOffer = await postJsonExpectingStatus(
      `${baseUrl}/commands`,
      {
        actor_id: actorId,
        actor_session: actorSession,
        offer_id: `${initialWorkOffer.offer_id}:tampered`,
        command: initialWorkOffer.command,
      },
      404,
    );
    assert(
      tamperedOffer.ok === false &&
        tamperedOffer.status === 404 &&
        tamperedOffer.error_kind === "unknown_offer" &&
        tamperedOffer.events?.length === 0,
      `Lantern Keeper accepted a tampered finale offer: ${JSON.stringify(tamperedOffer)}`,
    );

    await passCurrentHand(baseUrl, actorId, actorSession);
    const staleOffer = await postJsonExpectingStatus(
      `${baseUrl}/commands`,
      {
        actor_id: actorId,
        actor_session: actorSession,
        offer_id: initialWorkOffer.offer_id,
        command: initialWorkOffer.command,
      },
      409,
    );
    assert(
      staleOffer.ok === false &&
        staleOffer.status === 409 &&
        staleOffer.error_kind === "stale_offer" &&
        staleOffer.events?.length === 0,
      `Lantern Keeper accepted a stale finale offer: ${JSON.stringify(staleOffer)}`,
    );

    towerReady = await fetchInspectableState(baseUrl, actorId, actorSession);
    const freshWorkDeal = await dealOffer(
      baseUrl,
      actorId,
      actorSession,
      (offer) =>
        offer.kind === "work" &&
        matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"),
      "the refreshed finale Work card",
    );
    towerReady = freshWorkDeal.state;
    const freshWorkOffer = freshWorkDeal.offer;
    const readyQuestion = towerReady.shared_questions?.find(
      (question) => question.id === "lantern-keeper:rekindle-the-beacon",
    );
    assert(
      readyQuestion?.filled === 0 &&
        readyQuestion?.danger_filled === dangerBeforeFinale &&
        freshWorkOffer?.offer_id,
      `Lantern Keeper lost its finale after refreshing the hand: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
    );

    finalePayload = {
      actor_id: actorId,
      actor_session: actorSession,
      offer_id: freshWorkOffer.offer_id,
      command: freshWorkOffer.command,
      envelope: {
        ...offerEnvelope(towerReady, actorId, freshWorkOffer.offer_id),
        intent_id: "smoke:lantern-golden-finale",
      },
    };
    finale = await postJson(`${baseUrl}/commands`, finalePayload);
    assert(
      finale.ok === true &&
        finale.events?.filter(
          (event) => event.type === "job.contribution.resolved",
        ).length === 1 &&
        finale.events?.filter(
          (event) =>
            event.type === "job.updated" &&
            event.content?.includes(":completed:"),
        ).length === 1 &&
        finale.events?.filter((event) => event.type === "story.receipt")
          .length === 1,
      `Lantern Keeper finale did not resolve with one coherent receipt: ${JSON.stringify(finale)}`,
    );
    const retriedFinale = await postJson(`${baseUrl}/commands`, finalePayload);
    assert(
      JSON.stringify(retriedFinale) === JSON.stringify(finale),
      `Lantern Keeper finale retry was not idempotent: ${JSON.stringify({ finale, retriedFinale })}`,
    );
    const conflictingRetry = await postJsonExpectingStatus(
      `${baseUrl}/commands`,
      {
        ...finalePayload,
        offer_id: `${freshWorkOffer.offer_id}:tampered-retry`,
      },
      409,
    );
    assert(
      conflictingRetry.ok === false &&
        conflictingRetry.status === 409 &&
        conflictingRetry.output?.includes("intent_id is already bound") &&
        conflictingRetry.events?.length === 0,
      `Lantern Keeper accepted a conflicting finale retry: ${JSON.stringify(conflictingRetry)}`,
    );
  }

  const completedAtTower = await fetchInspectableState(
    baseUrl,
    actorId,
    actorSession,
  );
  const completedQuestion = completedAtTower.shared_questions?.find(
    (question) => question.id === "lantern-keeper:rekindle-the-beacon",
  );
  assert(
    completedQuestion?.presentation_state === "completed_memory" &&
      completedQuestion?.filled === 6 &&
      completedQuestion?.danger_filled === dangerBeforeFinale &&
      completedQuestion?.situation?.includes("Mothwood beacon") &&
      completedAtTower.tags?.some(
        (tag) => tag.id === "room:804:beacon_rekindled",
      ) &&
      (autonomousFinale ||
        completedAtTower.economy?.orbs === beforeFinaleOrbs + 2) &&
      !completedAtTower.action_offers?.some((offer) =>
        matchesContributionKind(offer.kind),
      ),
    `Lantern Keeper completion did not foreground one durable world change: ${JSON.stringify(lanternJourneySummary(completedAtTower))}`,
  );

  for (const destination of [
    "Flooded Barrow",
    "Saint Orra's Ruin",
    "Mothwood Path",
    "Wayside Lantern Inn",
  ]) {
    await command(baseUrl, actorId, actorSession, `go ${destination}`);
  }
  const trustedMara = await command(
    baseUrl,
    actorId,
    actorSession,
    "give Keeper's Brass Key to Mara Wick",
  );
  assert(
    trustedMara.events?.filter((event) =>
      event.type === "relationship.advanced" && event.content?.includes("earned trust")).length === 1,
    `Lantern Keeper did not pay off Mara's authored relationship exactly once: ${JSON.stringify(trustedMara)}`,
  );
  await command(baseUrl, actorId, actorSession, "go Mothwood Path");
  const completed = await fetchInspectableState(baseUrl, actorId, actorSession);
  const afterTravelQuestion = completed.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon");
  assert(
    afterTravelQuestion?.presentation_state === "completed_memory"
      && afterTravelQuestion?.filled === 6
      && afterTravelQuestion?.danger_filled === dangerBeforeFinale,
    `Lantern Keeper's post-finale travel reset completion before restart: ${JSON.stringify(lanternJourneySummary(completed))}`,
  );
  traceLantern("lantern completed", completed);
  return {
    state: completed,
    expected: {
      orbs: completed.economy?.orbs,
      progress: 6,
      danger: dangerBeforeFinale,
      completionSituation: completedQuestion.situation,
      finalePayload,
      finaleResponse: finale,
    },
  };
}

function matchesProjectOffer(offer, projectId) {
  return matchesContributionKind(offer?.kind) && offer?.project?.id === projectId;
}

function matchesContributionKind(kind) {
  return kind === "prepare" || kind === "work" || kind === "help";
}

function assertLanternGoldenReplay(state, events, expected) {
  const question = state.shared_questions?.find((candidate) =>
    candidate.id === "lantern-keeper:rekindle-the-beacon");
  const eventText = events
    .map((event) => [event.content, event.location_name, event.destination_location_name].filter(Boolean).join(" "))
    .join("\n");
  const route = [
    "The Cosy Cottage",
    "Rain-Soft Garden",
    "Mossbell Inn",
    "Wayside Lantern Inn",
    "Mothwood Path",
    "Saint Orra's Ruin",
    "Flooded Barrow",
    "Lantern Tower",
  ];
  const pickedUp = (itemId) => events.filter((event) =>
    event.type === "item.picked_up" && event.item_id === itemId).length;
  const itemUses = (itemId) => events.filter((event) =>
    event.type === "item.used" && event.item_id === itemId).length;
  const firstTaleContribution = events.find((event) =>
    event.type === "job.contribution.resolved"
      && event.content?.includes("rain-soft-garden:trustworthy-path"));
  const firstTaleTrace = events.filter((event) =>
    event.type === "first_tale.public_trace");

  assert(
    state.character_identity?.class_id === "lantern-warden"
      && state.character_identity?.class_label === "Lantern Warden"
      && state.character_identity?.class_readiness_evidence?.target?.label
        === "the drain carrying water across the path"
      && events.filter((event) => event.type === "class.chosen").length === 1,
    `Lantern replay lost the one-time Class choice: ${JSON.stringify(state.character_identity)}`,
  );
  assert(
    firstTaleContribution
      && firstTaleTrace.length === 1
      && firstTaleTrace[0].caused_by_event_seq === firstTaleContribution.seq,
    `Lantern replay lost or duplicated the explicit First Tale public trace: ${JSON.stringify(firstTaleTrace)}`,
  );
  assert(
    route.every((place) => eventText.includes(place))
      && events.filter(routeDiscoveryEvent).length === 6,
    `Lantern fiction recall lost its authored route: ${JSON.stringify({ route, eventText })}`,
  );
  assert(
    [8401, 8402, 8403, 8404, 8405].every((itemId) => pickedUp(itemId) === 1)
      && itemUses(8401) === 2
      && itemUses(8402) === 2
      && itemUses(8403) === 2
      && itemUses(8404) === 1,
    `Lantern replay duplicated or lost authored evidence items: ${JSON.stringify({
      pickups: [8401, 8402, 8403, 8404, 8405].map((id) => [id, pickedUp(id)]),
      uses: [8401, 8402, 8403, 8404].map((id) => [id, itemUses(id)]),
    })}`,
  );
  assert(
    events.filter((event) =>
      event.type === "combat.encounter.resolved"
        && event.target_actor_id === 8303
        && event.success === true).length === 1,
    "Lantern replay lost or duplicated the Moth-Eaten Knight resolution",
  );
  assert(
    events.filter((event) => event.type === "bond.created" && event.target_actor_id === 8301).length === 1
      && events.filter((event) =>
        event.type === "relationship.advanced"
          && event.target_actor_id === 8301
          && event.content?.includes("earned trust")).length === 1
      && state.bonds?.some((bond) => bond.target_actor_id === 8301 && bond.status === "active"),
    `Lantern replay lost Mara's relationship arc: ${JSON.stringify(state.bonds)}`,
  );
  assert(
    question?.presentation_state === "completed_memory"
      && question?.filled === expected.progress
      && question?.danger_filled === expected.danger
      && question?.situation === expected.completionSituation
      && state.economy?.orbs === expected.orbs
      && events.filter((event) =>
        event.type === "job.contribution.resolved"
          && event.content?.includes("lantern-keeper:rekindle-the-beacon")).length === 1
      && events.filter((event) => event.type === "first_tale.public_trace").length === 1
      && events.filter((event) =>
        event.type === "job.updated" && event.content?.includes(":completed:")).length === 1
      && events.filter((event) =>
        event.type === "story.receipt"
          && event.content?.includes("beacon burns again")
          && event.content?.includes("road trustworthy after dusk")).length === 1,
    `Lantern replay lost or duplicated completion: ${JSON.stringify({ question, economy: state.economy })}`,
  );
  const recallChecks = {
    rowan: eventText.includes("Rowan"),
    shadow: eventText.includes("shadow"),
    borrowed: eventText.includes("borrowed"),
    beacon: eventText.includes("beacon"),
    road: eventText.includes("road"),
    unresolvedFront: state.fronts?.some((front) =>
      front.presentation_state === "persisted"
        && front.outcome_statement?.includes("remains unresolved")),
  };
  assert(
    Object.values(recallChecks).every(Boolean),
    `Lantern fiction-recall gate could not answer Rowan, shadow, risk, world-change, and next-step questions in story language: ${JSON.stringify(recallChecks)}`,
  );
  assertLanternSuggestions(state, "lantern replay");
}

function assertMountedComposition(meta, spec, addedActorCount = 0, addedLocationCount = 0) {
  assert(meta.worldpack?.id === spec.worldpackId, JSON.stringify(meta.worldpack));
  assert(
    meta.worldpack?.packs?.map((pack) => pack.id).join(",") === spec.packIds.join(","),
    `${spec.label} mounted the wrong packs: ${JSON.stringify(meta.worldpack?.packs)}`,
  );
  if (spec.seedActorCount !== undefined) {
    const expectedActorCount = spec.seedActorCount + addedActorCount;
    assert(
      meta.world?.actor_count === expectedActorCount,
      `${spec.label} mounted ${meta.world?.actor_count} actors instead of ${expectedActorCount}`,
    );
  }
  if (spec.seedItemCount !== undefined) {
    assert(
      meta.world?.item_count === spec.seedItemCount,
      `${spec.label} mounted ${meta.world?.item_count} items instead of ${spec.seedItemCount}`,
    );
  }
  if (spec.seedLocationCount !== undefined) {
    const expectedLocationCount = spec.seedLocationCount + addedLocationCount;
    assert(
      meta.world?.location_count === expectedLocationCount,
      `${spec.label} mounted ${meta.world?.location_count} locations instead of ${expectedLocationCount}`,
    );
  }
}

function assertScene(state, spec, { requireOffer = true } = {}) {
  assert(state.location?.name === spec.location, JSON.stringify(state.location));
  const rulesContext = inspectedRulesContext(state);
  if (spec.selectedBy) {
    assert(
      rulesContext?.location_pack_id === spec.locationPack
        && rulesContext?.selected_by_pack_id === spec.selectedBy
        && rulesContext?.capability_id === spec.capability,
      `${spec.label} selected the wrong rules context: ${JSON.stringify(rulesContext)}`,
    );
  } else {
    assert(
      rulesContext == null,
      `${spec.label} unexpectedly selected a pack-local rules context: ${
        JSON.stringify(rulesContext)
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
      state.__inspection?.first_tale_question?.includes(spec.firstTaleQuestionIncludes),
      `${spec.label} exposed the wrong first-tale question: ${JSON.stringify(
        state.__inspection?.first_tale_question,
      )}`,
    );
  }
}

async function runWorldLoop(spec) {
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-standalone-world-"));
  const eventDbPath = resolve(tempDir, "events.sqlite");
  let first = null;
  let restarted = null;
  try {
    first = await startServer(tempDir, spec.registryPath, spec.entryLocationId);
    assertMountedComposition(first.meta, spec);
    if (spec.cardImagePath) {
      const image = await fetch(`${first.baseUrl}${spec.cardImagePath}`, {
        signal: AbortSignal.timeout(5_000),
      });
      assert(image.ok, `${spec.label} card image returned HTTP ${image.status}`);
      assert(
        image.headers.get("content-type") === "image/png",
        `${spec.label} card image used ${image.headers.get("content-type")}`,
      );
      assert(
        !image.headers.has("x-cosyworld-asset-diagnostic"),
        `${spec.label} card image returned an asset-provider diagnostic`,
      );
    }
    let created;
    try {
      created = await postJson(
        `${first.baseUrl}/avatar`,
        {
          name: `${spec.label} Walker`,
          ...spec.characterCreation,
        },
        spec.seedActorCount ? 10_000 : undefined,
      );
    } catch (error) {
      throw new Error(
        `${spec.label} avatar creation failed: ${error.message}\n${first.output.slice(-80).join("")}`,
      );
    }
    assert(created.ok && created.actor?.id && created.actor_session, JSON.stringify(created));
    const actorId = created.actor.id;
    const actorSession = created.actor_session;
    let finalLocationName = spec.location;
    let finalLocationPack = spec.locationPack;
    let goldenJourney = null;
    let actorNoticeCommitted = false;
    let initial = await fetchInspectableState(first.baseUrl, actorId, actorSession);
    assertScene(initial, spec, { requireOffer: false });
    if (spec.offerVerb) {
      const dealt = await dealOffer(
        first.baseUrl,
        actorId,
        actorSession,
        (offer) => spec.offerVerb === "Notice"
          ? offer.kind === "notice_actor"
          : offer.verb === spec.offerVerb,
        `${spec.label} ${spec.offerVerb} card`,
      );
      initial = dealt.state;
      assertScene(initial, spec);
      if (spec.offerVerb === "Notice") {
        const noticed = await command(first.baseUrl, actorId, actorSession, dealt.offer.command);
        assert(
          noticed.events?.some((event) => event.type === "notice.actor_observed"),
          `${spec.label} Notice produced no committed observation: ${JSON.stringify(noticed)}`,
        );
        actorNoticeCommitted = true;
        initial = await fetchInspectableState(first.baseUrl, actorId, actorSession);
      }
    } else {
      assertScene(initial, spec);
    }
    if (spec.goldenJourney) {
      goldenJourney = await beginLanternGoldenJourney(
        first.baseUrl,
        actorId,
        actorSession,
        initial,
      );
      finalLocationName = goldenJourney.state.location?.name || finalLocationName;
      finalLocationPack = inspectedRulesContext(goldenJourney.state)?.location_pack_id
        || finalLocationPack;
    }
    if (spec.localSeedActorCount !== undefined) {
      const localSeedActors = initial.actors?.filter((actor) => actor.id !== actorId) ?? [];
      const localSeedActorCount = localSeedActors.length;
      assert(
        localSeedActorCount === spec.localSeedActorCount,
        `${spec.label} exposed ${localSeedActorCount} local seed actors instead of ${spec.localSeedActorCount}`,
      );
      if (spec.localSeedActorControlMode) {
        assert(
          localSeedActors.every((actor) => actor.control_mode === spec.localSeedActorControlMode),
          `${spec.label} local seed actors did not use ${spec.localSeedActorControlMode}: ${JSON.stringify(localSeedActors)}`,
        );
      }
    }
    if (spec.localItemCount !== undefined) {
      assert(
        initial.items?.length === spec.localItemCount,
        `${spec.label} exposed ${initial.items?.length} local items instead of ${spec.localItemCount}`,
      );
    }

    let discovered = initial;
    let discoveryEventCount = 0;
    let revealedMoveTarget = spec.scoutDestination;
    let exactConnection = null;
    if (spec.scoutDestination) {
      if (spec.additionalScoutDestination) {
        await dealOffer(
          first.baseUrl,
          actorId,
          actorSession,
          (offer) => offer.kind === "explore_path"
            && offer.target?.label === spec.scoutDestination,
          `${spec.label} primary branching Scout route`,
        );
        await dealOffer(
          first.baseUrl,
          actorId,
          actorSession,
          (offer) => offer.kind === "explore_path"
            && offer.target?.label === spec.additionalScoutDestination,
          `${spec.label} additional branching Scout route`,
        );
      }
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const scouted = await command(
          first.baseUrl,
          actorId,
          actorSession,
          `scout ${spec.scoutDestination}`,
        );
        discoveryEventCount += scouted.events?.filter(routeDiscoveryEvent).length ?? 0;
        discovered = await fetchInspectableState(first.baseUrl, actorId, actorSession);
        if (!discovered.action_offers?.some((offer) =>
          offer.kind === "explore_path" && offer.target?.label === spec.scoutDestination)) break;
      }
      const revealedMove = await dealOffer(
        first.baseUrl,
        actorId,
        actorSession,
        (offer) => offer.kind === "move"
          && (spec.multiStepScoutPath || offer.target?.label === spec.scoutDestination),
        `${spec.label} discovered route Move card`,
      );
      discovered = revealedMove.state;
      revealedMoveTarget = revealedMove.offer.target?.label;
      assert(
        discoveryEventCount === 1
          && !discovered.action_offers?.some((offer) =>
            offer.kind === "explore_path" && offer.target?.label === spec.scoutDestination)
          && discovered.action_offers?.some((offer) =>
            offer.kind === "move" && offer.target?.label === revealedMoveTarget)
          && (!spec.multiStepScoutPath || revealedMoveTarget !== spec.scoutDestination),
        `${spec.label} did not reveal its route exactly once: ${JSON.stringify({
          discoveryEventCount,
          revealedMoveTarget,
          offers: discovered.action_offers?.map(({ kind, target }) => ({ kind, target })),
        })}`,
      );
      const repeated = await postJsonExpectingStatus(`${first.baseUrl}/commands`, {
        actor_id: actorId,
        actor_session: actorSession,
        command: `scout ${spec.scoutDestination}`,
      }, 404);
      assert(
        repeated.ok === false,
        `${spec.label} allowed its already-discovered route to be scouted again`,
      );

      if (spec.connectionItem) {
        await command(
          first.baseUrl,
          actorId,
          actorSession,
          `take ${spec.connectionItem}`,
        );
        await command(
          first.baseUrl,
          actorId,
          actorSession,
          `go ${revealedMoveTarget}`,
        );
        const atWaypoint = await fetchInspectableState(first.baseUrl, actorId, actorSession);
        const activeConnection = atWaypoint.shared_questions?.find((question) =>
          question.question?.includes(spec.connectionItem)
            && question.question.includes(spec.location));
        assert(
          ["active", "quiet"].includes(activeConnection?.presentation_state)
            && activeConnection.filled === 0
            && activeConnection.situation?.includes(spec.connectionItem)
            && activeConnection.situation.includes(spec.location),
          `${spec.label} did not expose its exact physical Connection: ${JSON.stringify(atWaypoint.shared_questions)}`,
        );

        const dropped = await command(
          first.baseUrl,
          actorId,
          actorSession,
          `drop ${spec.connectionItem}`,
        );
        assert(
          dropped.events?.filter((event) => event.type === "job.updated").length === 1
            && dropped.events?.filter((event) => event.type === "world.logistics.completed").length === 1,
          `${spec.label} exact Connection did not commit one causal completion: ${JSON.stringify(dropped)}`,
        );
        const connected = await fetchInspectableState(first.baseUrl, actorId, actorSession);
        const completedConnection = connected.shared_questions?.find((question) =>
          question.id === activeConnection.id);
        assert(
          completedConnection?.presentation_state === "completed_memory"
            && completedConnection.filled === completedConnection.segments
            && completedConnection.situation?.includes(spec.connectionItem)
            && completedConnection.situation.includes(spec.location),
          `${spec.label} exact Connection was not visible as completed history: ${JSON.stringify(completedConnection)}`,
        );
        finalLocationName = connected.location?.name || finalLocationName;
        finalLocationPack = inspectedRulesContext(connected)?.location_pack_id || finalLocationPack;
        exactConnection = {
          jobId: activeConnection.id,
          itemName: spec.connectionItem,
          originName: spec.location,
        };
      }
    }

    if (!spec.goldenJourney && !spec.noticeAbsent && !actorNoticeCommitted) {
      const noticeDeal = await dealOffer(
        first.baseUrl,
        actorId,
        actorSession,
        (offer) => offer.kind === "notice_actor",
        `${spec.label} actor Notice`,
      );
      const noticed = await command(first.baseUrl, actorId, actorSession, noticeDeal.offer.command);
      assert(
        noticed.events?.some((event) => event.type === "notice.actor_observed"),
        `${spec.label} Notice produced no committed observation: ${JSON.stringify(noticed)}`,
      );
    }
    const replayMarker = await commitReplayMarker(first.baseUrl, actorId, actorSession);
    const replayMarkerSeq = Math.max(
      ...(replayMarker.events || [])
        .filter((event) => event.actor_id === actorId)
        .map((event) => Number(event.seq) || 0),
    );
    assert(
      replayMarkerSeq > 0,
      `${spec.label} Think produced no actor-owned durable replay marker: ${JSON.stringify(replayMarker)}`,
    );
    const committed = await fetchInspectableState(first.baseUrl, actorId, actorSession);
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
    const routeDiscoveriesBeforeRestart = readDurableWorldEvents(
      eventDbPath,
    ).filter(routeDiscoveryEvent);
    if (spec.scoutDestination) {
      const discoveredDestinationIds = new Set(
        routeDiscoveriesBeforeRestart.map(
          (event) => event.destination_location_id,
        ),
      );
      assert(
        routeDiscoveriesBeforeRestart.length >= 1 &&
          discoveredDestinationIds.size === routeDiscoveriesBeforeRestart.length,
        `${spec.label} repeated a route discovery instead of preserving distinct player/avatar discoveries: ${JSON.stringify(routeDiscoveriesBeforeRestart)}`,
      );
    }
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

    if (spec.legacyGeneratedCheckpoint) {
      assert(
        inspection.compaction.action_journal_floor_seq > 0
          && inspection.compaction.action_journal_floor_seq <= durableJournalHead,
        `${spec.label} did not compact behind its production checkpoint: ${JSON.stringify(inspection.compaction)}`,
      );
      await rewriteElysiumCheckpointAsProductionLegacy(
        tempDir,
        spec.legacyGeneratedCheckpoint,
      );
    }

    restarted = await startServer(
      tempDir,
      spec.registryPath,
      spec.entryLocationId,
      { production: Boolean(spec.legacyGeneratedCheckpoint) },
    );
    assertMountedComposition(
      restarted.meta,
      spec,
      1,
      spec.multiStepScoutPath ? routeDiscoveriesBeforeRestart.length : 0,
    );
    assert(
      restarted.output.some((line) => line.includes("loaded journal checkpoint")),
      `${spec.label} restart did not use its journal checkpoint: ${
        restarted.output.slice(-40).join("")
      }`,
    );
    if (spec.legacyGeneratedCheckpoint) {
      assert(
        restarted.meta.persistence?.checkpoint_rejections === 0
          && restarted.meta.persistence.action_journal_floor_seq
            === inspection.compaction.action_journal_floor_seq,
        `${spec.label} rejected or bypassed its compacted production checkpoint: ${JSON.stringify(restarted.meta.persistence)}`,
      );
    }
    let replayed = await fetchInspectableState(restarted.baseUrl, actorId, actorSession);
    assertScene(
      replayed,
      { ...spec, location: finalLocationName, locationPack: finalLocationPack },
      { requireOffer: false },
    );
    let events = await fetchAllActorEvents(restarted.baseUrl, actorId, actorSession);
    assert(
      events.some((event) => event.seq === replayMarkerSeq),
      `${spec.label} restart lost event ${replayMarkerSeq}: ${JSON.stringify({
        replayed_event_seqs: events.map((event) => event.seq),
        durable_event_seqs: readDurableWorldEvents(eventDbPath).map((event) => event.seq),
        compaction: inspection.compaction,
      })}`,
    );
    if (spec.scoutDestination && !exactConnection) {
      const replayedMove = await dealOffer(
        restarted.baseUrl,
        actorId,
        actorSession,
        (offer) => offer.kind === "move" && offer.target?.label === revealedMoveTarget,
        `${spec.label} replayed route Move card`,
      );
      replayed = replayedMove.state;
      assert(
        !replayed.action_offers?.some((offer) =>
          offer.kind === "explore_path" && offer.target?.label === spec.scoutDestination)
          && replayed.action_offers?.some((offer) =>
            offer.kind === "move" && offer.target?.label === revealedMoveTarget),
        `${spec.label} restart lost its discovered route`,
      );
      events = await fetchAllActorEvents(restarted.baseUrl, actorId, actorSession);
    }
    if (exactConnection) {
      const completedConnection = replayed.shared_questions?.find((question) =>
        question.id === exactConnection.jobId);
      assert(
        completedConnection?.presentation_state === "completed_memory"
          && completedConnection.situation?.includes(exactConnection.itemName)
          && completedConnection.situation.includes(exactConnection.originName),
        `${spec.label} restart lost its exact Connection memory: ${JSON.stringify(completedConnection)}`,
      );
      events = await fetchAllActorEvents(restarted.baseUrl, actorId, actorSession);
      assert(
        events.filter((event) =>
          event.type === "world.logistics.completed"
            && event.item_name === exactConnection.itemName).length === 1,
        `${spec.label} restart lost or duplicated its exact physical delivery`,
      );
      if (spec.legacyGeneratedCheckpoint) {
        const replayedMove = await dealOffer(
          restarted.baseUrl,
          actorId,
          actorSession,
          (offer) => offer.kind === "move" && offer.target?.label === spec.location,
          `${spec.label} restored production route Move card`,
        );
        replayed = replayedMove.state;
        assert(
          replayedMove.offer.kind === "move"
            && Boolean(replayedMove.offer.target?.label)
            && !replayed.action_offers?.some((offer) =>
              offer.kind === "explore_path" && offer.target?.label === spec.location),
          `${spec.label} restored its discovered route as Scout instead of Move: ${JSON.stringify(replayed.action_offers)}`,
        );
      }
    }
    assert(
      replayed.world_seq >= committed.world_seq,
      `${spec.label} restart regressed ${committed.world_seq} to ${replayed.world_seq}`,
    );
    const durableEvents = readDurableWorldEvents(eventDbPath);
    if (spec.scoutDestination) {
      const durableRouteDiscoveries = durableEvents.filter(routeDiscoveryEvent);
      const preservedRouteDiscoveries = routeDiscoveriesBeforeRestart.every((expected) => (
        durableRouteDiscoveries.filter((actual) => (
          actual.seq === expected.seq
            && actual.location_id === expected.location_id
            && actual.destination_location_id === expected.destination_location_id
        )).length === 1
      ));
      assert(
        durableRouteDiscoveries.length >= routeDiscoveriesBeforeRestart.length
          && preservedRouteDiscoveries,
        `${spec.label} replay lost or duplicated a prior durable route discovery: ${JSON.stringify(durableRouteDiscoveries)}`,
      );
    }
    if (goldenJourney) {
      assertLanternGoldenReplay(
        replayed,
        durableEvents,
        goldenJourney.expected,
      );
      if (goldenJourney.expected.finalePayload) {
        const restartedFinale = await postJson(
          `${restarted.baseUrl}/commands`,
          goldenJourney.expected.finalePayload,
        );
        assert(
          JSON.stringify(restartedFinale) ===
            JSON.stringify(goldenJourney.expected.finaleResponse),
          `${spec.label} did not preserve the canonical finale receipt across restart: ${JSON.stringify(
            {
              expected: goldenJourney.expected.finaleResponse,
              actual: restartedFinale,
            },
          )}`,
        );
      }
      const afterRestartRetry = await fetchInspectableState(
        restarted.baseUrl,
        actorId,
        actorSession,
      );
      assert(
        afterRestartRetry.world_seq === replayed.world_seq
          && afterRestartRetry.economy?.orbs === replayed.economy?.orbs,
        `${spec.label} restart retry duplicated world state: ${JSON.stringify({
          before: { worldSeq: replayed.world_seq, orbs: replayed.economy?.orbs },
          after: { worldSeq: afterRestartRetry.world_seq, orbs: afterRestartRetry.economy?.orbs },
        })}`,
      );
    }
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
  const rejected = await postJsonExpectingStatus(`${server.baseUrl}/avatar`, {
    name: "No World Walker",
  }, 503);
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
  const requestedCase = process.env.COSYWORLD_COMPOSITION_SMOKE_CASE?.trim().toLowerCase();
  const selectedCases = requestedCase
    ? worldCases.filter((spec) => spec.label.toLowerCase() === requestedCase)
    : worldCases;
  assert(
    selectedCases.length > 0,
    `Unknown standalone composition smoke case: ${requestedCase}`,
  );
  for (const spec of selectedCases) await access(spec.registryPath, constants.R_OK);
  await access(resolve(contentRoot, "services-only/registry.json"), constants.R_OK);

  const matrix = [];
  for (const spec of selectedCases) matrix.push(await runWorldLoop(spec));
  if (!requestedCase) matrix.push(await runServicesLoop());
  console.log(JSON.stringify({ ok: true, matrix }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
