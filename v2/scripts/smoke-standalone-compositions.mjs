#!/usr/bin/env node
import { constants } from "node:fs";
import { createHash } from "node:crypto";
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
    ],
    location: "Bethlehem",
    locationPack: "cosyworld.the-holy-land",
    selectedBy: "cosyworld.core",
    capability: "cosyworld.core/rules",
    offerVerb: null,
    firstTaleAbsent: true,
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
    ],
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
    offerVerb: "Tune in",
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
    seedActorCount: 485,
    seedItemCount: 485,
    seedLocationCount: 485,
    localSeedActorCount: 1,
    localSeedActorControlMode: "local_ai",
    localItemCount: 1,
    scoutDestination: "Void 002",
    additionalScoutDestination: "Void 003",
    multiStepScoutPath: true,
    connectionItem: "Void Token 001",
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

async function startServer(tempDir, registryPath, entryLocationId) {
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
    COSYWORLD_V2_SNAPSHOT_PATH: resolve(tempDir, "snapshot.json"),
    COSYWORLD_V2_EVENT_DB_PATH: resolve(tempDir, "events.sqlite"),
    COSYWORLD_V2_GENERATED_ASSET_DIR: resolve(tempDir, "generated"),
  });
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

function stateUrl(baseUrl, actorId, actorSession) {
  const query = new URLSearchParams({
    actor_id: String(actorId),
    actor_session: actorSession,
  });
  return `${baseUrl}/state?${query}`;
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
  const actor = state.actors?.find((candidate) => candidate.id === actorId) ?? {};
  return {
    world_id: state.world_id ?? "world://cosyworld/official",
    intent_id: `smoke:offer:${actorId}:${createHash("sha256").update(offerId).digest("hex")}`,
    actor_ref: actor.canonical_ref ?? "",
    observed: {},
    last_world_seq: Number(state.world_seq ?? 0),
  };
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
    state = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
    offer = state.action_offers?.find((candidate) => !candidate.disabled && predicate(candidate));
    if (offer) break;
    if (maxPassAttempts === 0) {
      maxPassAttempts = Math.max(1, Number(state.action_hand?.deck_size ?? 0));
    }
    if (passAttempts >= maxPassAttempts) break;
    const passOffer = state.action_hand?.pass;
    assert(
      passOffer?.offer_id,
      `No dealt card matches ${description} and Think is unavailable: ${JSON.stringify(state.action_hand)}`,
    );
    const passPayload = {
      actor_id: actorId,
      actor_session: actorSession,
      command: "pass",
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
    `The finite hand did not deal ${description} within ${maxPassAttempts} Passes: ${JSON.stringify({
      hand: state?.action_hand,
      offers: state?.action_offers?.map(({ kind, command, label }) => ({ kind, command, label })),
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
  const turnExempt = /^(wield|unwield|prepare-spell|unprepare-spell|stow|unstow)\b/i.test(value);
  const requestedKind = value.trim().toLowerCase();
  const matchesRequestedOffer = (candidate) =>
    candidate.command === value
      || (requestedKind === "search" && candidate.kind === "search")
      || (requestedKind === "bond mara wick" && candidate.kind === "create_bond" && candidate.target?.id === 8301);
  const maxRedeals = 4;
  let staleRedeals = 0;
  let turnLockedRedeals = 0;
  while (true) {
    const dealt = turnExempt ? {} : await dealOffer(
      baseUrl, actorId, actorSession, matchesRequestedOffer, value,
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
    if (!turnExempt && submitted.status === 409 && staleRedeals++ < maxRedeals) continue;
    if (!turnExempt && submitted.status === 423 && turnLockedRedeals++ < 2) continue;
    const result = submitted.body;
    assert(result.ok === true, `${value} failed: ${JSON.stringify(result)}`);
    return result;
  }
}

async function passCurrentHand(baseUrl, actorId, actorSession) {
  const state = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  const passOffer = state.action_hand?.pass;
  assert(passOffer?.offer_id, `a bounded deal must expose Think: ${JSON.stringify(state.action_hand)}`);
  const passed = await postJsonWithStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    command: "pass",
    offer_id: passOffer.offer_id,
    envelope: offerEnvelope(state, actorId, passOffer.offer_id),
  });
  assert(
    passed.status >= 200 && passed.status < 300 && passed.body.ok === true,
    `Think failed while committing the replay marker: ${JSON.stringify(passed)}`,
  );
  return passed.body;
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
  if (question.resolution !== "active") {
    assert(
      question.suggested_actions?.length === 0,
      `${label} retained suggestions after resolution: ${JSON.stringify(question.suggested_actions)}`,
    );
    return;
  }
  assert(
    question.suggested_actions?.length === 2
      && question.suggested_actions.every((suggestion) =>
        suggestion.offer_id
          && suggestion.state_revision === state.world_seq
          && suggestion.label
          && suggestion.target_label
          && suggestion.source
          && suggestion.likely_effect?.includes("current progress is")
          && suggestion.likely_effect?.includes("danger is")),
    `${label} did not expose exactly two accessible truthful suggestions: ${JSON.stringify(question.suggested_actions)}`,
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
    listened.events?.some((event) => event.type === "ability_check.rolled")
      && listened.events?.some((event) => event.type === "ledger.banked"),
    `Lantern Keeper Cottage Notice did not bank its first useful lead: ${JSON.stringify(listened)}`,
  );

  let taleState = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    taleState.first_tale?.phase === "follow_lead"
      && taleState.first_tale?.required_location_id === 2,
    `Lantern Keeper did not retain its Garden lead after Notice: ${JSON.stringify(taleState.first_tale)}`,
  );
  for (let step = 0; step < 4 && taleState.first_tale?.phase !== "contribute"; step += 1) {
    const offer = firstTaleAdvancingOffer(taleState, `lantern Garden step ${step + 1}`);
    await command(baseUrl, actorId, actorSession, offer.command);
    taleState = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
      taleState = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
    }
  }
  const contributionEvent = firstContribution?.events?.find((event) =>
    event.type === "job.contribution.resolved");
  const traceEvents = firstContribution?.events?.filter((event) =>
    event.type === "first_tale.public_trace") ?? [];
  assert(
    contributionEvent
      && traceEvents.length === 1
      && traceEvents[0].caused_by_event_seq === contributionEvent.seq,
    `Lantern Keeper first contribution did not emit one explicit replay-safe public trace: ${JSON.stringify(firstContribution)}`,
  );
  taleState = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    taleState.first_tale?.phase === "complete"
      && taleState.first_tale?.continuation?.destination_location_id === 800
      && taleState.first_tale?.continuation?.target_actor_id === 8301
      && taleState.first_tale?.continuation?.job_id === "lantern-keeper:rekindle-the-beacon"
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
  const classed = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
    taleState = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  }
  assert(
    taleState.location?.id === 800
      && taleState.first_tale?.continuation?.phase === "arrived",
    `Lantern Keeper did not reach Mara through the server-authored continuation: ${JSON.stringify(lanternJourneySummary(taleState))}`,
  );
  traceLantern("lantern arrival", taleState);

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

  const readyForMara = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  traceLantern("lantern ready for Mara", readyForMara);
  const maraOffer = firstTaleAdvancingOffer(readyForMara, "lantern Mara continuation");
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
  const acceptedMara = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    acceptedMara.first_tale?.continuation?.phase === "accepted"
      && acceptedMara.first_tale?.continuation?.target_actor_id === 8301
      && acceptedMara.first_tale?.continuation?.instruction?.includes("dark-road lead")
      && acceptedMara.first_tale?.advancing_offer_id == null,
    `Lantern continuation did not settle after Mara's active bond: ${JSON.stringify(acceptedMara.first_tale)}`,
  );

  const scouted = await command(baseUrl, actorId, actorSession, "scout Mothwood Path");
  assert(
    scouted.events?.filter(routeDiscoveryEvent).length === 1,
    `Lantern Keeper did not reveal the route to Mothwood exactly once: ${JSON.stringify(scouted)}`,
  );
  await command(baseUrl, actorId, actorSession, "go Mothwood Path");
  const mothwood = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
  await command(baseUrl, actorId, actorSession, "scout Saint Orra's Ruin");
  await command(baseUrl, actorId, actorSession, "go Saint Orra's Ruin");
  const saintOrra = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
  await command(baseUrl, actorId, actorSession, "scout Flooded Barrow");
  await command(baseUrl, actorId, actorSession, "go Flooded Barrow");
  const barrow = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
  const barrowResolved = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    !barrowResolved.combat
      && !barrowResolved.action_offers?.some((offer) => offer.kind === "attack"),
    `Lantern Keeper's authored nonviolent Barrow resolution left a combat behind: ${JSON.stringify(lanternJourneySummary(barrowResolved))}`,
  );
  traceLantern("lantern Flooded Barrow resolved", barrowResolved);

  await command(baseUrl, actorId, actorSession, "scout Lantern Tower");
  await command(baseUrl, actorId, actorSession, "go Lantern Tower");
  const tower = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
  let towerReady = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
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
    towerReady = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  }
  const initialWorkDeal = await dealOffer(baseUrl, actorId, actorSession, (offer) =>
    offer.kind === "work" && matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"), "the finale Work card");
  towerReady = initialWorkDeal.state;
  const initialWorkOffer = initialWorkDeal.offer;
  assert(
    initialWorkOffer?.offer_id && initialWorkOffer?.command === "contribute rekindle-beacon",
    `Lantern Keeper did not expose the authoritative finale offer: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
  );
  traceLantern("lantern Tower ready", towerReady);
  const dangerBeforeMeaningfulRest = Number(towerReady.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon")?.danger_filled || 0);

  const tamperedOffer = await postJsonExpectingStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    offer_id: `${initialWorkOffer.offer_id}:tampered`,
    command: initialWorkOffer.command,
  }, 404);
  assert(
    tamperedOffer.ok === false
      && tamperedOffer.status === 404
      && tamperedOffer.error_kind === "unknown_offer"
      && tamperedOffer.events?.length === 0,
    `Lantern Keeper accepted a tampered finale offer: ${JSON.stringify(tamperedOffer)}`,
  );

  const firstTowerListen = await command(baseUrl, actorId, actorSession, "listen");
  const staleOffer = await postJsonExpectingStatus(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    offer_id: initialWorkOffer.offer_id,
    command: initialWorkOffer.command,
  }, 409);
  assert(
    staleOffer.ok === false
      && staleOffer.status === 409
      && staleOffer.error_kind === "stale_offer"
      && staleOffer.events?.length === 0,
    `Lantern Keeper accepted a stale finale offer: ${JSON.stringify(staleOffer)}`,
  );

  const repeatedListen = await command(baseUrl, actorId, actorSession, "listen");
  assert(
    repeatedListen.events?.some((event) =>
      event.type === "tag.applied" && event.tag_label === "tired"),
    `Lantern Keeper repeat frontier action did not create a meaningful Rest choice: ${JSON.stringify(repeatedListen)}`,
  );
  const tiredAtTower = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  await dealOffer(baseUrl, actorId, actorSession, (offer) => offer.kind === "rest", "the Rest card");
  const rested = await command(baseUrl, actorId, actorSession, "rest");
  assert(
    rested.events?.some((event) =>
      event.type === "tag.cleared" && event.tag_label === "tired")
      && rested.events?.some((event) =>
        event.type === "clock.updated"
          && event.clock_id === "lantern-keeper.darkness"
          && event.clock_filled === dangerBeforeMeaningfulRest + 1),
    `Lantern Keeper Rest did not trade recovery for authored danger: ${JSON.stringify(rested)}`,
  );
  towerReady = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  const freshWorkDeal = await dealOffer(baseUrl, actorId, actorSession, (offer) =>
    offer.kind === "work" && matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"), "the refreshed finale Work card");
  towerReady = freshWorkDeal.state;
  const freshWorkOffer = freshWorkDeal.offer;
  const readyQuestion = towerReady.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon");
  assert(
    readyQuestion?.filled === 0
      && readyQuestion?.danger_filled === dangerBeforeMeaningfulRest + 1
      && freshWorkOffer?.offer_id
      && rested.receipt?.world_id
      && rested.receipt?.actor_ref,
    `Lantern Keeper lost its finale after the meaningful Rest choice: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
  );

  const finalePayload = {
    actor_id: actorId,
    actor_session: actorSession,
    offer_id: freshWorkOffer.offer_id,
    command: freshWorkOffer.command,
    envelope: { ...offerEnvelope(towerReady, actorId, freshWorkOffer.offer_id), intent_id: "smoke:lantern-golden-finale" },
  };
  const beforeFinaleOrbs = towerReady.economy?.orbs;
  const finale = await postJson(`${baseUrl}/commands`, finalePayload);
  assert(
    finale.ok === true
      && finale.events?.filter((event) => event.type === "job.contribution.resolved").length === 1
      && finale.events?.filter((event) =>
        event.type === "job.updated" && event.content?.includes(":completed:")).length === 1
      && finale.events?.filter((event) => event.type === "story.receipt").length === 1,
    `Lantern Keeper finale did not resolve with one coherent receipt: ${JSON.stringify(finale)}`,
  );
  const retriedFinale = await postJson(`${baseUrl}/commands`, finalePayload);
  assert(
    JSON.stringify(retriedFinale) === JSON.stringify(finale),
    `Lantern Keeper finale retry was not idempotent: ${JSON.stringify({ finale, retriedFinale })}`,
  );
  const conflictingRetry = await postJsonExpectingStatus(`${baseUrl}/commands`, {
    ...finalePayload,
    offer_id: `${freshWorkOffer.offer_id}:tampered-retry`,
  }, 409);
  assert(
    conflictingRetry.ok === false
      && conflictingRetry.status === 409
      && conflictingRetry.output?.includes("intent_id is already bound")
      && conflictingRetry.events?.length === 0,
    `Lantern Keeper accepted a conflicting finale retry: ${JSON.stringify(conflictingRetry)}`,
  );

  const completedAtTower = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  const completedQuestion = completedAtTower.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon");
  assert(
    completedQuestion?.presentation_state === "completed_memory"
      && completedQuestion?.resolution === "completed"
      && completedQuestion?.filled === 6
      && completedQuestion?.danger_filled === dangerBeforeMeaningfulRest + 1
      && completedQuestion?.completion_memory?.includes("Mothwood beacon")
      && completedAtTower.tags?.some((tag) => tag.id === "room:804:beacon_rekindled")
      && completedAtTower.economy?.orbs === beforeFinaleOrbs + 2
      && !completedAtTower.action_offers?.some((offer) => matchesContributionKind(offer.kind)),
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
  const completed = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  const afterTravelQuestion = completed.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon");
  assert(
    afterTravelQuestion?.presentation_state === "completed_memory"
      && afterTravelQuestion?.resolution === "completed"
      && afterTravelQuestion?.filled === 6
      && afterTravelQuestion?.danger_filled === dangerBeforeMeaningfulRest + 1,
    `Lantern Keeper's post-finale travel reset completion before restart: ${JSON.stringify(lanternJourneySummary(completed))}`,
  );
  traceLantern("lantern completed", completed);
  return {
    state: completed,
    expected: {
      orbs: completed.economy?.orbs,
      progress: 6,
      danger: dangerBeforeMeaningfulRest + 1,
      dangerSituation: completedQuestion.danger_situation,
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
      && question?.resolution === "completed"
      && question?.filled === expected.progress
      && question?.danger_filled === expected.danger
      && question?.danger_situation === expected.dangerSituation
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
      front.id === "lantern-keeper:hollow-light"
        && front.presentation_state === "persisted"
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
    first = await startServer(tempDir, spec.registryPath, spec.entryLocationId);
    assertMountedComposition(first.meta, spec);
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
    let initial = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assertScene(initial, spec, { requireOffer: false });
    if (spec.offerVerb) {
      const dealt = await dealOffer(
        first.baseUrl,
        actorId,
        actorSession,
        (offer) => offer.verb === spec.offerVerb,
        `${spec.label} ${spec.offerVerb} card`,
      );
      initial = dealt.state;
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
      finalLocationPack = goldenJourney.state.rules_context?.location_pack_id || finalLocationPack;
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
        const initialScoutTargets = initial.action_offers
          ?.filter((offer) => offer.kind === "explore_path")
          .map((offer) => offer.target?.label);
        assert(
          initialScoutTargets?.includes(spec.scoutDestination)
            && initialScoutTargets.includes(spec.additionalScoutDestination),
          `${spec.label} did not expose its branching Scout routes: ${JSON.stringify(initialScoutTargets)}`,
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
        discovered = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
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
        const atWaypoint = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
        const activeConnection = atWaypoint.shared_questions?.find((question) =>
          question.question?.includes(spec.connectionItem)
            && question.question.includes(spec.location));
        assert(
          activeConnection?.resolution === "active"
            && activeConnection.filled === 0
            && activeConnection.strategies?.some((strategy) =>
              strategy.label?.includes(spec.connectionItem)
                && strategy.availability_reason?.includes(spec.connectionItem)),
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
        const connected = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
        const completedConnection = connected.shared_questions?.find((question) =>
          question.id === activeConnection.id);
        assert(
          completedConnection?.resolution === "completed"
            && completedConnection.presentation_state === "completed_memory"
            && completedConnection.filled === completedConnection.segments
            && completedConnection.completion_memory?.includes(spec.connectionItem)
            && completedConnection.completion_memory.includes(spec.location),
          `${spec.label} exact Connection was not visible as completed history: ${JSON.stringify(completedConnection)}`,
        );
        finalLocationName = connected.location?.name || finalLocationName;
        finalLocationPack = connected.rules_context?.location_pack_id || finalLocationPack;
        exactConnection = {
          jobId: activeConnection.id,
          itemName: spec.connectionItem,
          originName: spec.location,
        };
      }
    }

    if (!spec.goldenJourney) {
      const listened = await command(first.baseUrl, actorId, actorSession, "listen");
      assert(
        listened.events?.length > 0,
        `${spec.label} Listen produced no committed events: ${JSON.stringify(listened)}`,
      );
    }
    const replayMarker = await passCurrentHand(first.baseUrl, actorId, actorSession);
    const replayMarkerSeq = Math.max(
      ...(replayMarker.events || [])
        .filter((event) => event.actor_id === actorId)
        .map((event) => Number(event.seq) || 0),
    );
    assert(
      replayMarkerSeq > 0,
      `${spec.label} Think produced no actor-owned durable replay marker: ${JSON.stringify(replayMarker)}`,
    );
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

    restarted = await startServer(tempDir, spec.registryPath, spec.entryLocationId);
    assertMountedComposition(restarted.meta, spec, 1, spec.multiStepScoutPath ? 1 : 0);
    assert(
      restarted.output.some((line) => line.includes("loaded journal checkpoint")),
      `${spec.label} restart did not use its journal checkpoint: ${
        restarted.output.slice(-40).join("")
      }`,
    );
    let replayed = await fetchJson(stateUrl(restarted.baseUrl, actorId, actorSession));
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
        completedConnection?.resolution === "completed"
          && completedConnection.presentation_state === "completed_memory"
          && completedConnection.completion_memory?.includes(exactConnection.itemName)
          && completedConnection.completion_memory.includes(exactConnection.originName),
        `${spec.label} restart lost its exact Connection memory: ${JSON.stringify(completedConnection)}`,
      );
      events = await fetchAllActorEvents(restarted.baseUrl, actorId, actorSession);
      assert(
        events.filter((event) =>
          event.type === "world.logistics.completed"
            && event.item_name === exactConnection.itemName).length === 1,
        `${spec.label} restart lost or duplicated its exact physical delivery`,
      );
    }
    assert(
      replayed.world_seq >= committed.world_seq,
      `${spec.label} restart regressed ${committed.world_seq} to ${replayed.world_seq}`,
    );
    const durableEvents = readDurableWorldEvents(eventDbPath);
    if (spec.scoutDestination) {
      const durableRouteDiscoveries = durableEvents.filter(routeDiscoveryEvent);
      assert(
        durableRouteDiscoveries.length === 1,
        `${spec.label} replay did not retain exactly one durable route discovery: ${JSON.stringify(durableRouteDiscoveries)}`,
      );
    }
    if (goldenJourney) {
      assertLanternGoldenReplay(replayed, durableEvents, goldenJourney.expected);
      const restartedFinale = await postJson(
        `${restarted.baseUrl}/commands`,
        goldenJourney.expected.finalePayload,
      );
      assert(
        JSON.stringify(restartedFinale) === JSON.stringify(goldenJourney.expected.finaleResponse),
        `${spec.label} did not preserve the canonical finale receipt across restart: ${JSON.stringify({
          expected: goldenJourney.expected.finaleResponse,
          actual: restartedFinale,
        })}`,
      );
      const afterRestartRetry = await fetchJson(stateUrl(restarted.baseUrl, actorId, actorSession));
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
