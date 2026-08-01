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
    marker: "Bethlehem journal loop",
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
    ],
    location: "Wayside Lantern Inn",
    locationPack: "cosyworld.campaign.the-lantern-keeper",
    selectedBy: "cosyworld.core",
    capability: "cosyworld.core/rules",
    offerVerb: null,
    firstTaleAbsent: true,
    marker: "Lantern Keeper journal loop",
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
    marker: "elysium journal loop",
    seedActorCount: 485,
    seedItemCount: 485,
    seedLocationCount: 485,
    localSeedActorCount: 1,
    localItemCount: 1,
    scoutDestination: "Void 002",
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

async function beginLanternGoldenJourney(baseUrl, actorId, actorSession, initial) {
  assert(
    initial.character_identity?.level === 0
      && initial.character_identity?.class_id == null
      && initial.character_identity?.class_selection_ready === false,
    `Lantern Keeper did not begin classless at level 0: ${JSON.stringify(lanternJourneySummary(initial))}`,
  );
  traceLantern("lantern arrival", initial);

  const searched = await command(baseUrl, actorId, actorSession, "search");
  assert(
    searched.events?.some((event) => event.type === "feature.searched")
      && searched.events?.some((event) => event.type === "class.selection_ready"),
    `Lantern Keeper first search did not reveal the failing-lantern lead and Class choice: ${JSON.stringify(searched)}`,
  );
  const ready = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    ready.character_identity?.class_selection_ready === true
      && ready.character_identity?.class_recommendation?.class_id === "mothwood-guide",
    `Lantern Keeper first committed action did not freeze its Class evidence: ${JSON.stringify(lanternJourneySummary(ready))}`,
  );
  traceLantern("lantern first action", ready);

  const chosen = await postJson(`${baseUrl}/avatar/class`, {
    actor_id: actorId,
    actor_session: actorSession,
    character_creation_id: "the-lantern-keeper",
    class_id: "mothwood-guide",
  });
  assert(
    chosen.ok === true && chosen.events?.filter((event) => event.type === "class.chosen").length === 1,
    `Lantern Keeper Class selection did not commit exactly once: ${JSON.stringify(chosen)}`,
  );
  const duplicate = await postJson(`${baseUrl}/avatar/class`, {
    actor_id: actorId,
    actor_session: actorSession,
    character_creation_id: "the-lantern-keeper",
    class_id: "lantern-warden",
  });
  assert(
    duplicate.ok === false && duplicate.status === 409,
    `Lantern Keeper allowed Class selection to be replayed: ${JSON.stringify(duplicate)}`,
  );
  const classed = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  assert(
    classed.character_identity?.level === 1
      && classed.character_identity?.class_id === "mothwood-guide"
      && classed.character_identity?.class_selection_ready === false,
    `Lantern Keeper Class choice did not produce one level-1 avatar: ${JSON.stringify(lanternJourneySummary(classed))}`,
  );
  traceLantern("lantern class chosen", classed);

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

  const listened = await command(baseUrl, actorId, actorSession, "listen");
  assert(
    listened.events?.some((event) => event.type === "ledger.banked"),
    `Lantern Keeper Listen did not bank the first visit evidence: ${JSON.stringify(listened)}`,
  );
  const readyForMara = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  traceLantern("lantern ready for Mara", readyForMara);
  const maraOffer = readyForMara.action_offers?.find((offer) =>
    offer.kind === "create_bond" && offer.target?.id === 8301 && offer.target?.label === "Mara Wick");
  assert(
    maraOffer?.command?.startsWith("bond Mara Wick: "),
    `Lantern Keeper did not prioritize Mara's authored relationship: ${JSON.stringify(lanternJourneySummary(readyForMara))}`,
  );
  const metMara = await command(baseUrl, actorId, actorSession, maraOffer.command);
  assert(
    metMara.events?.filter((event) => event.type === "bond.created").length === 1
      && metMara.events?.filter((event) => event.type === "relationship.beat").length === 1
      && metMara.events?.some((event) =>
        event.type === "relationship.beat" && event.content?.includes("empty key hook")),
    `Lantern Keeper did not commit Mara's corrected authored relationship beat: ${JSON.stringify(metMara)}`,
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
  const shortcut = await postJson(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    command: "work",
  });
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
  const initialWorkOffer = towerReady.action_offers?.find((offer) =>
    offer.kind === "work" && matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"));
  assert(
    initialWorkOffer?.offer_id && initialWorkOffer?.command === "contribute rekindle-beacon",
    `Lantern Keeper did not expose the authoritative finale offer: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
  );
  traceLantern("lantern Tower ready", towerReady);

  const tamperedOffer = await postJson(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    offer_id: `${initialWorkOffer.offer_id}:tampered`,
    command: initialWorkOffer.command,
  });
  assert(
    tamperedOffer.ok === false
      && tamperedOffer.status === 404
      && tamperedOffer.error_kind === "unknown_offer"
      && tamperedOffer.events?.length === 0,
    `Lantern Keeper accepted a tampered finale offer: ${JSON.stringify(tamperedOffer)}`,
  );

  const firstTowerListen = await command(baseUrl, actorId, actorSession, "listen");
  const staleOffer = await postJson(`${baseUrl}/commands`, {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    offer_id: initialWorkOffer.offer_id,
    command: initialWorkOffer.command,
  });
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
  assert(
    tiredAtTower.action_offers?.some((offer) => offer.kind === "rest" && offer.disabled === false),
    `Lantern Keeper could not Rest after taking time at the Tower: ${JSON.stringify(lanternJourneySummary(tiredAtTower))}`,
  );
  const rested = await command(baseUrl, actorId, actorSession, "rest");
  assert(
    rested.events?.some((event) =>
      event.type === "tag.cleared" && event.tag_label === "tired")
      && rested.events?.some((event) =>
        event.type === "clock.updated"
          && event.clock_id === "lantern-keeper.darkness"
          && event.clock_filled === 1),
    `Lantern Keeper Rest did not trade recovery for authored danger: ${JSON.stringify(rested)}`,
  );
  towerReady = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
  const readyQuestion = towerReady.shared_questions?.find((question) =>
    question.id === "lantern-keeper:rekindle-the-beacon");
  const freshWorkOffer = towerReady.action_offers?.find((offer) =>
    offer.kind === "work" && matchesProjectOffer(offer, "lantern-keeper:rekindle-the-beacon"));
  assert(
    readyQuestion?.filled === 0
      && readyQuestion?.danger_filled === 1
      && freshWorkOffer?.offer_id
      && rested.receipt?.world_id
      && rested.receipt?.actor_ref,
    `Lantern Keeper lost its finale after the meaningful Rest choice: ${JSON.stringify(lanternJourneySummary(towerReady))}`,
  );

  const finalePayload = {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    offer_id: freshWorkOffer.offer_id,
    command: freshWorkOffer.command,
    envelope: {
      world_id: rested.receipt.world_id,
      intent_id: "smoke:lantern-golden-finale",
      actor_ref: rested.receipt.actor_ref,
      observed: {},
      last_world_seq: rested.receipt.world_seq,
    },
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
  const conflictingRetry = await postJson(`${baseUrl}/commands`, {
    ...finalePayload,
    offer_id: `${freshWorkOffer.offer_id}:tampered-retry`,
  });
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
      && completedQuestion?.danger_filled === 1
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
  traceLantern("lantern completed", completed);
  return {
    state: completed,
    expected: {
      orbs: completed.economy?.orbs,
      progress: 6,
      danger: 1,
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

  assert(
    state.character_identity?.class_id === "mothwood-guide"
      && state.character_identity?.class_label === "Mothwood Guide"
      && state.character_identity?.class_readiness_evidence?.target?.label === "Failing Lantern"
      && events.filter((event) => event.type === "class.chosen").length === 1,
    `Lantern replay lost the one-time Class choice: ${JSON.stringify(state.character_identity)}`,
  );
  assert(
    route.every((place) => eventText.includes(place))
      && events.filter(routeDiscoveryEvent).length === 4,
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
      && question?.danger_situation?.includes("road lamp goes out")
      && state.economy?.orbs === expected.orbs
      && events.filter((event) => event.type === "job.contribution.resolved").length === 1
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

function assertMountedComposition(meta, spec, addedActorCount = 0) {
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
    assert(
      meta.world?.location_count === spec.seedLocationCount,
      `${spec.label} mounted ${meta.world?.location_count} locations instead of ${spec.seedLocationCount}`,
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
          wallet_address: walletAddress,
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
    let goldenJourney = null;
    const initial = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assertScene(initial, spec);
    if (spec.goldenJourney) {
      goldenJourney = await beginLanternGoldenJourney(
        first.baseUrl,
        actorId,
        actorSession,
        initial,
      );
      finalLocationName = goldenJourney.state.location?.name || finalLocationName;
    }
    if (spec.localSeedActorCount !== undefined) {
      const localSeedActorCount =
        initial.actors?.filter((actor) => actor.id !== actorId).length ?? 0;
      assert(
        localSeedActorCount === spec.localSeedActorCount,
        `${spec.label} exposed ${localSeedActorCount} local seed actors instead of ${spec.localSeedActorCount}`,
      );
    }
    if (spec.localItemCount !== undefined) {
      assert(
        initial.items?.length === spec.localItemCount,
        `${spec.label} exposed ${initial.items?.length} local items instead of ${spec.localItemCount}`,
      );
    }

    let discovered = initial;
    let discoveryEventCount = 0;
    if (spec.scoutDestination) {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const scouted = await command(
          first.baseUrl,
          actorId,
          actorSession,
          `scout ${spec.scoutDestination}`,
        );
        discoveryEventCount += scouted.events?.filter(routeDiscoveryEvent).length ?? 0;
        discovered = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
        if (!discovered.action_offers?.some((offer) => offer.kind === "explore_path")) break;
      }
      assert(
        discoveryEventCount === 1
          && !discovered.action_offers?.some((offer) => offer.kind === "explore_path")
          && discovered.action_offers?.some((offer) =>
            offer.kind === "move" && offer.target?.label === spec.scoutDestination),
        `${spec.label} did not reveal its route exactly once: ${JSON.stringify({
          discoveryEventCount,
          offers: discovered.action_offers?.map(({ kind, target }) => ({ kind, target })),
        })}`,
      );
      const repeated = await postJson(`${first.baseUrl}/commands`, {
        actor_id: actorId,
        actor_session: actorSession,
        wallet_address: walletAddress,
        command: `scout ${spec.scoutDestination}`,
      });
      assert(
        repeated.ok === false,
        `${spec.label} allowed its already-discovered route to be scouted again`,
      );
    }

    if (!spec.goldenJourney) {
      const listened = await command(first.baseUrl, actorId, actorSession, "listen");
      assert(
        listened.events?.length > 0,
        `${spec.label} Listen produced no committed events: ${JSON.stringify(listened)}`,
      );
    }
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

    restarted = await startServer(tempDir, spec.registryPath, spec.entryLocationId);
    assertMountedComposition(restarted.meta, spec, 1);
    assert(
      restarted.output.some((line) => line.includes("loaded journal checkpoint")),
      `${spec.label} restart did not use its journal checkpoint: ${
        restarted.output.slice(-40).join("")
      }`,
    );
    const replayed = await fetchJson(stateUrl(restarted.baseUrl, actorId, actorSession));
    assertScene(replayed, { ...spec, location: finalLocationName }, { requireOffer: false });
    if (spec.scoutDestination) {
      assert(
        !replayed.action_offers?.some((offer) => offer.kind === "explore_path")
          && replayed.action_offers?.some((offer) =>
            offer.kind === "move" && offer.target?.label === spec.scoutDestination),
        `${spec.label} restart lost its discovered route`,
      );
    }
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
    if (spec.scoutDestination) {
      assert(
        events.events?.filter(routeDiscoveryEvent).length === 1,
        `${spec.label} replay did not retain exactly one route discovery`,
      );
    }
    if (goldenJourney) {
      assertLanternGoldenReplay(replayed, events.events || [], goldenJourney.expected);
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
