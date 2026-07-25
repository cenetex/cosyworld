#!/usr/bin/env node
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const v2Root = resolve(scriptDir, "..");
const orchestratorDir = resolve(v2Root, "orchestrator-rust");
const binaryPath = process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY
  ? resolve(process.env.COSYWORLD_COMPOSITION_SMOKE_BINARY)
  : resolve(orchestratorDir, "target/debug/cosyworld-orchestrator");
const registryPath = resolve(v2Root, "content/core-ruby/registry.json");
const contentRoot = resolve(v2Root, "content");
const walletAddress = "core-ruby-composition-smoke";

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

async function startServer(tempDir) {
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
    COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
    COSYWORLD_DISABLE_CTRL_C_SHUTDOWN: "1",
    COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET: "1",
    COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS: "0",
    COSYWORLD_CANONICAL_LEASE_TTL_MS: "1000",
    COSYWORLD_V2_SNAPSHOT_PATH: "off",
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
  const meta = await waitForMeta(baseUrl, proc, output);
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

async function move(baseUrl, actorId, actorSession, destinationLocationId) {
  const result = await postJson(`${baseUrl}/actions/move`, {
    actor_id: actorId,
    actor_session: actorSession,
    wallet_address: walletAddress,
    destination_location_id: destinationLocationId,
  });
  assert(
    result.ok === true,
    `move to ${destinationLocationId} failed: ${JSON.stringify(result)}`,
  );
  return result;
}

async function submitOffer(baseUrl, offer, path, payload, compositionId = offer.composition_id) {
  return postJson(`${baseUrl}/actions/submit`, {
    path,
    offer_id: offer.offer_id,
    composition_id: compositionId,
    kind: offer.kind,
    rules_action: offer.rules_action,
    operation: offer.operation,
    rules_profile: offer.rules_profile,
    state_revision: offer.state_revision,
    target: offer.target,
    cost: offer.cost,
    payload,
  });
}

async function discoverExit(baseUrl, actorId, actorSession, destinationLocationId) {
  await command(baseUrl, actorId, actorSession, "listen");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const state = await fetchJson(stateUrl(baseUrl, actorId, actorSession));
    if (state.exits?.some((exit) =>
      exit.destination_location_id === destinationLocationId
      && exit.accessible === true
      && exit.locked === false)) {
      return state;
    }
    await command(baseUrl, actorId, actorSession, "search");
  }
  throw new Error(`exit ${destinationLocationId} was not discovered after 32 searches`);
}

function assertContext(state, {
  location,
  locationPack,
  selectedBy,
  capability,
  offerVerb,
  sourceCard,
}) {
  assert(state.location?.name === location, `expected ${location}: ${JSON.stringify(state.location)}`);
  assert(
    state.rules_context?.location_pack_id === locationPack
      && state.rules_context?.selected_by_pack_id === selectedBy
      && state.rules_context?.capability_id === capability,
    `wrong rules context at ${location}: ${JSON.stringify(state.rules_context)}`,
  );
  assert(
    state.action_offers?.some((offer) => offer.verb === offerVerb),
    `missing ${offerVerb} vocabulary at ${location}: ${JSON.stringify(
      state.action_offers?.map(({ kind, verb, command, target }) => ({
        kind,
        verb,
        command,
        target,
      })),
    )}`,
  );
  assert(
    state.action_offers?.some((offer) =>
      offer.composition_trace?.source_card_instances?.some((card) =>
        card.card_id === sourceCard && card.pack_id === locationPack)),
    `missing ${sourceCard} action-card context at ${location}`,
  );
  assert(
    state.action_offers?.every((offer) =>
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
  await access(registryPath, constants.R_OK);
  const tempDir = await mkdtemp(resolve(tmpdir(), "cosyworld-core-ruby-"));
  let first = null;
  let second = null;

  try {
    first = await startServer(tempDir);
    assert(first.meta.worldpack?.id === "cosyworld.core-ruby", JSON.stringify(first.meta.worldpack));
    assert(
      first.meta.worldpack?.packs?.map((pack) => pack.id).join(",")
        === [
          "cosyworld.rules-srd-5.2.1",
          "cosyworld.rules-profile-srd5",
          "cosyworld.core",
          "ruby-high.first-bell",
        ].join(","),
      `wrong mounted packs: ${JSON.stringify(first.meta.worldpack?.packs)}`,
    );

    const created = await postJson(`${first.baseUrl}/avatar`, {
      name: "Boundary Walker",
      wallet_address: walletAddress,
    });
    assert(created.ok && created.actor?.id && created.actor_session, JSON.stringify(created));
    const actorId = created.actor.id;
    const actorSession = created.actor_session;

    const cottage = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assertContext(cottage, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });
    await command(first.baseUrl, actorId, actorSession, "say core side");
    const discovered = await discoverExit(first.baseUrl, actorId, actorSession, 11);
    const travelOffer = discovered.action_offers?.find((offer) =>
      offer.kind === "move"
      && offer.verb === "Travel"
      && offer.target?.id === 11);
    assert(
      travelOffer,
      `discovered Homeroom path did not become a Core Travel offer: ${JSON.stringify(
        discovered.action_offers,
      )}`,
    );
    const travelPayload = {
      actor_id: actorId,
      actor_session: actorSession,
      wallet_address: walletAddress,
      destination_location_id: 11,
    };
    const rejectedTravel = await submitOffer(
      first.baseUrl,
      travelOffer,
      "/actions/move",
      travelPayload,
      `sha256:${"0".repeat(64)}`,
    );
    assert(
      rejectedTravel.ok === false
        && rejectedTravel.status === 409
        && rejectedTravel.events?.some((event) =>
          event.type === "action.offer_rejected"
          && event.content?.includes("scene composition changed")),
      `tampered composition certificate did not fail closed: ${JSON.stringify(rejectedTravel)}`,
    );
    const afterRejectedTravel = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assert(
      afterRejectedTravel.location?.id === cottage.location.id
        && afterRejectedTravel.world_seq === discovered.world_seq,
      `rejected composition certificate mutated the scene: ${JSON.stringify({
        before: { location: discovered.location, world_seq: discovered.world_seq },
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

    const homeroom = await fetchJson(stateUrl(first.baseUrl, actorId, actorSession));
    assertContext(homeroom, {
      location: "Homeroom",
      locationPack: "ruby-high.first-bell",
      selectedBy: "ruby-high.first-bell",
      capability: "ruby-high.first-bell/rules",
      offerVerb: "Tune in",
      sourceCard: "location-homeroom",
    });
    assert(
      homeroom.account?.owned_cards?.some((card) =>
        card.card_id === "location-homeroom" && card.owned === true),
      `Homeroom pass missing after entry: ${JSON.stringify(homeroom.account)}`,
    );
    await command(first.baseUrl, actorId, actorSession, "say ruby side");
    const worldSeqBeforeRestart = homeroom.world_seq;

    await stopServer(first.proc);
    first = null;
    second = await startServer(tempDir);
    const replayed = await fetchJson(stateUrl(second.baseUrl, actorId, actorSession));
    assertContext(replayed, {
      location: "Homeroom",
      locationPack: "ruby-high.first-bell",
      selectedBy: "ruby-high.first-bell",
      capability: "ruby-high.first-bell/rules",
      offerVerb: "Tune in",
      sourceCard: "location-homeroom",
    });
    assert(
      replayed.world_seq >= worldSeqBeforeRestart,
      `journal replay regressed ${worldSeqBeforeRestart} to ${replayed.world_seq}`,
    );
    const replayQuery = new URLSearchParams({
      actor_id: String(actorId),
      actor_session: actorSession,
      wallet_address: walletAddress,
      limit: "500",
    });
    const replayEvents = await fetchJson(`${second.baseUrl}/events?${replayQuery}`);
    assert(
      replayEvents.events?.some((event) =>
        event.type === "message.created" && event.content === "core side")
        && replayEvents.events?.some((event) =>
          event.type === "message.created" && event.content === "ruby side")
        && replayEvents.events?.some((event) => event.type === "rules_context.changed"),
      `journal replay lost the action loop: ${JSON.stringify(replayEvents.events)}`,
    );

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
    const returnedCore = await move(second.baseUrl, actorId, actorSession, 1);
    assert(
      returnedCore.events?.some((event) => event.type === "rules_context.changed"),
      `Ruby → Core transition missing: ${JSON.stringify(returnedCore.events)}`,
    );
    const returned = await fetchJson(stateUrl(second.baseUrl, actorId, actorSession));
    assertContext(returned, {
      location: "The Cosy Cottage",
      locationPack: "cosyworld.core",
      selectedBy: "cosyworld.core",
      capability: "cosyworld.core/rules",
      offerVerb: "Notice",
      sourceCard: "cosy-cottage",
    });

    console.log(JSON.stringify({
      ok: true,
      worldpack: second.meta.worldpack.id,
      packs: second.meta.worldpack.packs.map((pack) => pack.id),
      loop: [
        "The Cosy Cottage",
        "Homeroom",
        "journal replay",
        "The Cosy Cottage",
      ],
    }, null, 2));
  } finally {
    if (first) await stopServer(first.proc);
    if (second) await stopServer(second.proc);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
