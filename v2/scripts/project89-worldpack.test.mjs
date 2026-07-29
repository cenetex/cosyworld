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

test("Project 89 keeps Ring 1 authored and opens exactly four item-commissioned spokes", () => {
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
  assert.ok(innerSpokes.every((exit) => (exit.flags & 1) === 1));

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
    const unlocks = hook.effects.filter((effect) => effect.op === "unlock_exit");
    assert.deepEqual(
      unlocks.map((effect) => [effect.from_location_id, effect.to_location_id]),
      [endpoints, [...endpoints].reverse()],
    );
  }
});

test("Project 89 Ring 2 is a cubic mesh with generated route interiors", () => {
  const exits = readJson("project89-perimeter-relay", "exits.json");
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
  assert.ok([...degrees.values()].every((degree) => degree === 3));
  assert.ok([...edges.values()].every((exit) => exit.distance === 2));
  assert.equal(edges.size - degrees.size + 1, 5);
  assert.equal(policy.topology.profile_id, "regional_mesh");
  assert.equal(policy.place_anchor.action_label, "Scan the sector");
  assert.equal(policy.place_anchor.target_label, "a Signal Anchor");
  assert.equal(policy.media.prompt_prefix, "P89, anime style,");
});

test("Project 89 Ring 3 is a four-station 89-step circuit within kernel capacity", () => {
  const ring1Locations = readJson("project89-operation-liberation", "locations.json");
  const ring2Locations = readJson("project89-perimeter-relay", "locations.json");
  const ring3Locations = readJson("project89-open-signal-frontier", "locations.json");
  const ring2Exits = readJson("project89-perimeter-relay", "exits.json");
  const ring3Exits = readJson("project89-open-signal-frontier", "exits.json");
  const bridgeExits = readJson("project89-three-rings-bridge", "exits.json");
  const policy = readJson("project89-open-signal-frontier", "pack.json")
    .extensions["x-cosyworld-generation"];
  const ring3Edges = undirectedEdges(ring3Exits);

  assert.equal(ring3Locations.length, 4);
  assert.equal(ring3Edges.size, 4);
  assert.ok([...ring3Edges.values()].every((exit) => exit.distance === 89));
  assert.equal(policy.topology.profile_id, "open_frontier");
  assert.equal(policy.topology.budgets.weighted_distance.min, 178);

  const stationReturns = bridgeExits.filter((exit) =>
    exit.from_location_id >= 8940
    && exit.from_location_id <= 8943
    && exit.to_location_id >= 8920
    && exit.to_location_id <= 8927);
  assert.equal(stationReturns.length, 4);
  assert.ok(stationReturns.every((exit) => (exit.flags & 1) === 0));

  const authoredLocations =
    ring1Locations.length + ring2Locations.length + ring3Locations.length;
  const ring2Waypoints = [...undirectedEdges(ring2Exits).values()]
    .reduce((total, exit) => total + exit.distance - 1, 0);
  const ring3Waypoints = [...ring3Edges.values()]
    .reduce((total, exit) => total + exit.distance - 1, 0);
  assert.equal(authoredLocations + ring2Waypoints + ring3Waypoints, 385);
  assert.ok(authoredLocations + ring2Waypoints + ring3Waypoints <= 512);
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
