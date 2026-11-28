import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../../card-game/world.mjs";
import { reducers } from "./parity.mjs";

function seedState(world) {
  return {
    run: world.run,
    doors: world.doors,
    wayfinder: world.items["elysium-wayfinder"].holder,
    draws: Object.fromEntries(
      Object.entries(world.packs).map(([id, pack]) => [id, pack.specials]),
    ),
  };
}

test("fresh seed initialization matches the pinned run, home doors, and Wayfinder", async () => {
  const { pinned, wasm } = await reducers();
  const world = createWorld({ opening: true });
  const landings = new Set();
  for (const seed of [0, 1, 2, 3, 4, 5, 7, 17, 42, 4242, 4_294_967_295]) {
    const reference = pinned({ op: "create", seed });
    assert.equal(reference.ok, true, reference.error);
    const actual = wasm({ op: "seed_opening", seed, world });
    assert.ok(actual, `seed ${seed} was unsupported`);
    assert.deepEqual(seedState(actual.world), seedState(reference.world));
    assert.equal(actual.world.turn, world.turn);
    assert.equal(actual.world.revision, world.revision);
    landings.add(actual.world.items["elysium-wayfinder"].holder);
  }
  assert.deepEqual([...landings].sort(), ["behind-station", "pond", "station"]);
});

test("seed initialization declines existing seeds and open travel gates", async () => {
  const { wasm } = await reducers();
  const world = createWorld({ opening: true });
  const request = { op: "seed_opening", seed: 7, world };
  assert.equal(
    wasm({ ...request, world: { ...world, run: { seed: 1 } } }),
    null,
  );
  assert.equal(
    wasm({ ...request, world: { ...world, sharedVersion: 1 } }),
    null,
  );
  const traveled = structuredClone(world);
  for (const id of ["paddle", "sheet", "rope", "provisions"]) {
    traveled.items[`willows-${id}`].holder = "willows-camp";
  }
  assert.equal(wasm({ ...request, world: traveled }), null);
});
