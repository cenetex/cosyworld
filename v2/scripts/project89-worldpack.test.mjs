import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  routeDirectionValidationErrors,
  routeDiscoveryValidationErrors,
} from "./route-direction.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(scriptDir, "../content");

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(contentRoot, ...segments), "utf8"));
}

function undirectedEdges(exits) {
  return new Map(
    exits.map((exit) => {
      const key = [exit.from_location_id, exit.to_location_id]
        .sort((left, right) => left - right)
        .join(":");
      return [key, exit];
    }),
  );
}

function weightedDiameter(nodeIds, edges) {
  const distances = new Map(nodeIds.flatMap((left) =>
    nodeIds.map((right) => [`${left}:${right}`, left === right ? 0 : Infinity])));
  for (const [key, edge] of edges) {
    const [left, right] = key.split(":").map(Number);
    distances.set(`${left}:${right}`, edge.distance);
    distances.set(`${right}:${left}`, edge.distance);
  }
  for (const through of nodeIds) {
    for (const left of nodeIds) {
      for (const right of nodeIds) {
        distances.set(`${left}:${right}`, Math.min(
          distances.get(`${left}:${right}`),
          distances.get(`${left}:${through}`) + distances.get(`${through}:${right}`),
        ));
      }
    }
  }
  return Math.max(...distances.values());
}

function bridgeCount(nodeIds, edges) {
  let bridges = 0;
  for (const removedKey of edges.keys()) {
    const visited = new Set([nodeIds[0]]);
    const pending = [nodeIds[0]];
    while (pending.length) {
      const current = pending.shift();
      for (const key of edges.keys()) {
        if (key === removedKey) continue;
        const [left, right] = key.split(":").map(Number);
        const next = left === current ? right : right === current ? left : null;
        if (next !== null && !visited.has(next)) {
          visited.add(next);
          pending.push(next);
        }
      }
    }
    if (visited.size !== nodeIds.length) bridges += 1;
  }
  return bridges;
}

function assertExchangeCycle(actors, itemIds) {
  assert.ok(actors.every((actor) => actor.ambient_autonomy === true));
  assert.deepEqual(
    new Set(actors.flatMap((actor) => actor.attachments.map((entry) => entry.item_id))),
    itemIds,
  );
  assert.deepEqual(
    new Set(actors.flatMap((actor) => actor.desires.map((entry) => entry.item_id))),
    itemIds,
  );
  assert.ok(actors.every((actor) =>
    actor.attachments[0].item_id !== actor.desires[0].item_id));
}

test("Project 89 keeps Ring 1 authored and commissions four permanent two-stage routes", () => {
  const exits = readJson("project89-operation-liberation", "exits.json");
  const bridgeExits = readJson("project89-three-rings-bridge", "exits.json");
  const hooks = readJson("project89-operation-liberation", "lifecycle_hooks.json");

  assert.equal(undirectedEdges(exits).size, 10);
  assert.deepEqual(
    [...undirectedEdges(exits).keys()].sort(),
    [
      "8900:8901",
      "8900:8907",
      "8901:8902",
      "8902:8903",
      "8903:8904",
      "8904:8905",
      "8904:8908",
      "8905:8906",
      "8906:8907",
      "8907:8908",
    ],
  );

  const innerSpokes = bridgeExits.filter((exit) =>
    exit.from_location_id >= 8900
    && exit.from_location_id <= 8908
    && exit.to_location_id >= 8920
    && exit.to_location_id <= 8927);
  assert.equal(innerSpokes.length, 4);
  assert.ok(bridgeExits.every((exit) => (exit.flags & 1) === 1));

  const expectedKeys = new Map([
    [8971, [8902, 8921]],
    [8979, [8908, 8926]],
    [8983, [8906, 8925]],
    [8973, [8907, 8922]],
  ]);
  for (const hook of hooks) {
    const endpoints = expectedKeys.get(Number(hook.target_id));
    assert.ok(endpoints, `unexpected relay-key hook ${hook.target_id}`);
    assert.equal(hook.claim_scope, "world_target_once");
    assert.deepEqual(hook.requirements, [
      { kind: "active_tag", tag_id: "room:8906:inner_loop_liberated" },
    ]);
    const unlocks = hook.effects.filter((effect) => effect.op === "unlock_exit");
    const outerByItem = new Map([
      [8971, [8921, 8940]],
      [8979, [8926, 8941]],
      [8983, [8925, 8942]],
      [8973, [8922, 8943]],
    ]);
    const outer = outerByItem.get(Number(hook.target_id));
    assert.deepEqual(
      unlocks.map((effect) => [effect.from_location_id, effect.to_location_id]),
      [endpoints, [...endpoints].reverse(), outer, [...outer].reverse()],
    );
  }

  const job = readJson("project89-operation-liberation", "jobs.json")[0];
  assert.equal(job.reward.orbs, 8);
  assert.deepEqual(
    job.contribution_strategies.map((strategy) => strategy.id),
    ["expose-the-protocol", "reroute-with-consent", "dismantle-and-covenant"],
  );
  assert.ok(readJson("project89-operation-liberation", "actors.json")
    .some((actor) => actor.name === "White Rabbit"));
});

test("Project 89 Ring 2 is an irregular populated web with no bridges", () => {
  const exits = readJson("project89-perimeter-relay", "exits.json");
  const locations = readJson("project89-perimeter-relay", "locations.json");
  const actors = readJson("project89-perimeter-relay", "actors.json");
  const items = readJson("project89-perimeter-relay", "items.json");
  const factions = readJson("project89-perimeter-relay", "factions.json");
  const jobs = readJson("project89-perimeter-relay", "jobs.json");
  const sheets = readJson("project89-perimeter-relay", "room_sheets.json");
  const policy = readJson("project89-perimeter-relay", "pack.json")
    .extensions["x-cosyworld-generation"];
  const edges = undirectedEdges(exits);
  const degrees = new Map();
  for (const key of edges.keys()) {
    const [left, right] = key.split(":").map(Number);
    degrees.set(left, (degrees.get(left) ?? 0) + 1);
    degrees.set(right, (degrees.get(right) ?? 0) + 1);
  }

  assert.equal(edges.size, 12);
  assert.equal(degrees.size, 8);
  assert.deepEqual([...degrees.values()].sort(), [2, 3, 3, 3, 3, 3, 3, 4]);
  assert.equal(weightedDiameter(locations.map((location) => location.id), edges), 11);
  assert.equal(bridgeCount(locations.map((location) => location.id), edges), 0);
  assert.equal(edges.size - degrees.size + 1, 5);
  assert.equal(actors.length, 8);
  assert.equal(items.length, 8);
  assert.equal(factions.length, 3);
  assertExchangeCycle(actors, new Set(items.map((item) => item.id)));
  assert.equal(jobs[0].reward.orbs, 4);
  assert.equal(jobs[0].contribution_strategies.length, 4);
  assert.ok(sheets.every((sheet) =>
    sheet.projects.includes("project89:stabilize-perimeter-relay")));
  assert.equal(policy.topology.profile_id, "regional_mesh");
  assert.deepEqual(policy.topology.budgets.weighted_distance, { min: 11, max: 11 });
  assert.equal(policy.place_anchor.action_label, "Scan the sector");
  assert.equal(policy.place_anchor.target_label, "a Signal Anchor");
  assert.equal(policy.media.prompt_prefix, "P89, anime style,");
});

test("Project 89 Ring 3 is a populated longhaul circuit within kernel capacity", () => {
  const ring1Locations = readJson("project89-operation-liberation", "locations.json");
  const ring2Locations = readJson("project89-perimeter-relay", "locations.json");
  const ring3Locations = readJson("project89-open-signal-frontier", "locations.json");
  const ring2Exits = readJson("project89-perimeter-relay", "exits.json");
  const ring3Exits = readJson("project89-open-signal-frontier", "exits.json");
  const bridgeExits = readJson("project89-three-rings-bridge", "exits.json");
  const policy = readJson("project89-open-signal-frontier", "pack.json")
    .extensions["x-cosyworld-generation"];
  const frontier = readJson("project89-open-signal-frontier", "pack.json")
    .extensions["x-project89-frontier"];
  const actors = readJson("project89-open-signal-frontier", "actors.json");
  const items = readJson("project89-open-signal-frontier", "items.json");
  const factions = readJson("project89-open-signal-frontier", "factions.json");
  const jobs = readJson("project89-open-signal-frontier", "jobs.json");
  const sheets = readJson("project89-open-signal-frontier", "room_sheets.json");
  const ring3Edges = undirectedEdges(ring3Exits);

  assert.equal(ring3Locations.length, 4);
  assert.equal(ring3Edges.size, 4);
  assert.ok([...ring3Edges.values()].every((exit) => exit.distance === 89));
  assert.equal(policy.topology.profile_id, "open_frontier");
  assert.equal(policy.topology.budgets.weighted_distance.min, 178);
  assert.equal(frontier.executable_trunk_distance, 89);
  assert.equal(frontier.narrative_trunk_span, 89);
  assert.equal(actors.length, 4);
  assert.equal(items.length, 4);
  assert.equal(factions.length, 2);
  assertExchangeCycle(actors, new Set(items.map((item) => item.id)));
  assert.equal(jobs[0].reward.orbs, 8);
  assert.ok(sheets.every((sheet) =>
    sheet.projects.includes("project89:charter-the-open-circuit")));

  const stationReturns = bridgeExits.filter((exit) =>
    exit.from_location_id >= 8940
    && exit.from_location_id <= 8943
    && exit.to_location_id >= 8920
    && exit.to_location_id <= 8927);
  assert.equal(stationReturns.length, 4);
  assert.ok(stationReturns.every((exit) => (exit.flags & 1) === 1));

  const authoredLocations =
    ring1Locations.length + ring2Locations.length + ring3Locations.length;
  const ring2Waypoints = [...undirectedEdges(ring2Exits).values()]
    .reduce((total, exit) => total + exit.distance - 1, 0);
  const ring3Waypoints = [...ring3Edges.values()]
    .reduce((total, exit) => total + exit.distance - 1, 0);
  assert.equal(authoredLocations + ring2Waypoints + ring3Waypoints, 406);
  assert.ok(authoredLocations + ring2Waypoints + ring3Waypoints <= 2048);
});

test("Project 89 generated-place terminology never falls back to cairns", () => {
  for (const pack of ["project89-perimeter-relay", "project89-open-signal-frontier"]) {
    const manifest = readJson(pack, "pack.json");
    const policy = manifest.extensions["x-cosyworld-generation"];
    assert.doesNotMatch(JSON.stringify(policy.place_anchor), /\bcairn\b/i);
    assert.match(policy.place_anchor.visual_description, /teal/i);
    assert.match(policy.place_anchor.visual_description, /coral/i);
  }
});

test("Project 89 route directions are runtime-canonical and collision-free", () => {
  const exits = [
    ...readJson("project89-operation-liberation", "exits.json"),
    ...readJson("project89-perimeter-relay", "exits.json"),
    ...readJson("project89-open-signal-frontier", "exits.json"),
    ...readJson("project89-three-rings-bridge", "exits.json"),
  ];

  assert.deepEqual(routeDirectionValidationErrors(exits, []), []);
});

test("Project 89 keeps authored infrastructure known and exploration routes scoutable", () => {
  const operationExits = readJson(
    "project89-operation-liberation",
    "exits.json",
  );
  const bridgeExits = readJson("project89-three-rings-bridge", "exits.json");
  const perimeterExits = readJson("project89-perimeter-relay", "exits.json");
  const frontierExits = readJson(
    "project89-open-signal-frontier",
    "exits.json",
  );
  const exits = [
    ...operationExits,
    ...bridgeExits,
    ...perimeterExits,
    ...frontierExits,
  ];

  assert.deepEqual(routeDiscoveryValidationErrors(exits), []);
  assert.ok(operationExits.every((exit) => exit.discovery === "known"));
  assert.ok(bridgeExits.every((exit) => exit.discovery === "known"));
  assert.ok(perimeterExits.every((exit) => exit.discovery === "scout"));
  assert.ok(frontierExits.every((exit) => exit.discovery === "scout"));
});

test("Project 89 seeds Callum and activates owner-first-connect Proxim8 materialization", () => {
  const pack = readJson("project89-operation-liberation", "pack.json");
  const actors = readJson("project89-operation-liberation", "actors.json");
  const items = readJson("project89-operation-liberation", "items.json");
  const cards = readJson("project89-operation-liberation", "cards.json");
  const policy = pack.extensions["x-cosyworld-actor-materialization"];

  assert.deepEqual(policy.collection, {
    name: "PROXIM8",
    address: "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf",
    chain: "solana",
    standard: "metaplex_core",
  });
  assert.equal(policy.trigger, "first_verified_wallet_connection");
  assert.equal(policy.ownership.authority, "trusted_server_feed");
  assert.equal(policy.ownership.wallet_signature_proves_ownership, false);
  assert.equal(policy.custody_changes_control, false);
  assert.equal(policy.direct_actor_session, false);
  assert.equal(policy.ambient_autonomy, true);
  assert.equal(policy.media.trigger_word, "P89");
  assert.equal(policy.media.base_model, "flux-1");
  assert.equal(policy.media.lora_strength, 1);
  assert.equal(policy.media.refinement_model, "flux-2");
  assert.equal(policy.media.style, "washed-out watercolor anime style");

  const callum = actors.find((actor) => actor.id === policy.pilot.actor_id);
  assert.equal(callum.name, "Callum Synclaire");
  assert.equal(callum.location_id, 8900);
  assert.equal(callum.ambient_autonomy, true);
  assert.match(JSON.stringify(callum.goals), /other Proxim8s/i);
  assert.ok(callum.attachments.some(({ item_id }) => item_id === 8984));
  assert.ok(items.some((item) => item.id === 8984 && /no right to command/i.test(item.description)));
  assert.ok(cards.some((card) =>
    card.subject_id === callum.id
    && card.card_id === "project89-proxim8-callum-synclaire"));
  assert.equal(policy.pilot.asset_id, "Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo");
});
