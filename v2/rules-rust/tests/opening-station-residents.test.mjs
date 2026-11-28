import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_residents";

function captureResidents(source) {
  const marker =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `      const chosen = read2 ?? plan(next, id).action;
      const capture = next.actors.vale.place === "station" && (id === "moth" || id === "keeper");
      const before = capture && structuredClone(next);
      perform(next, chosen, round2, residents2);
      if (capture) globalThis.hub[id] = {key: chosen.key, before, after: structuredClone(next)};`,
  );
}

test("Pip follows to Station with pinned memories and Keeper waits silently", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureResidents);
  const run = (request) => {
    const result = pinned(request);
    assert.equal(result.ok, true, result.error);
    return result.world;
  };
  let saved;
  for (const seed of [undefined, 0, 2, 17, 42, 4242, 4_294_967_295]) {
    for (const waited of [false, true]) {
      for (const lamp of ["stowed", "dry"]) {
        let world = run({ op: "create", seed });
        if (lamp === "stowed") {
          world = run({
            ...seats,
            op: "hold",
            world,
            choice: { item: null, revision: world.revision },
          });
        } else {
          Object.assign(world.items.lamp, {
            fuel: 0,
            fuelRooms: 0,
            lit: false,
          });
        }
        if (waited)
          world = run({ ...seats, op: "play", world, action: "wait:vale::" });
        world = run({ ...seats, op: "play", world, action: "move:vale::pond" });
        const spoken = run({
          ...seats,
          op: "speech",
          world,
          room: "pond",
          lines: [{ entityId: "pond", text: "Water laps the shore." }],
        });
        for (const [key, prior] of [
          ["move:vale::station", world],
          ["move:vale:lamp:station", spoken],
        ]) {
          const sorted = seed === 2 || seed === 4242;
          const actors = sorted
            ? Object.fromEntries(Object.entries(prior.actors).toSorted())
            : prior.actors;
          reference.hub = {};
          const request = {
            ...seats,
            op: "play",
            world: { ...prior, actors },
            action: sorted ? { key } : key,
          };
          const reply = JSON.parse(
            reference.cardShared(JSON.stringify(request)),
          );
          assert.equal(reply.ok, true, reply.error);
          const { moth, keeper } = JSON.parse(JSON.stringify(reference.hub));
          const label = `${seed} ${waited} ${lamp} ${key}`;
          assert.equal(moth.key, "move:moth::station", label);
          assert.equal(keeper.key, "wait:keeper::", label);
          assert.ok(isDeepStrictEqual(moth.after, keeper.before), label);
          assert.ok(isDeepStrictEqual(keeper.before, keeper.after), label);
          saved = moth.before;
          const actual = wasm({ op, world: saved });
          assert.ok(actual?.ok, `unsupported ${label}`);
          assert.equal(actual.world.actors.moth.place, "station");
          assert.equal(actual.world.actors.moth.dwellUntil, waited ? 29 : 27);
          assert.equal(actual.world.items.cloth.holder, "moth");
          const differing = Object.keys(keeper.after).find(
            (key) => !isDeepStrictEqual(actual.world[key], keeper.after[key]),
          );
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: keeper.after }),
            `${label} ${differing ?? "extra fields"}`,
          );
        }
      }
    }
  }
  for (const change of [
    (world) => {
      world.actors.moth.sleeping = { until: 40 };
    },
    (world) => {
      world.actors.keeper.heldItem = null;
    },
    (world) => {
      world.items.cloth.holder = "keeper";
    },
    (world) => {
      world.actors.mara.place = "station";
    },
    (world) => {
      world.actors.vale.visited.pop();
    },
    (world) => {
      world.arrival.seq -= 1;
    },
  ]) {
    const world = structuredClone(saved);
    change(world);
    assert.equal(wasm({ op, world }), null);
  }
});
