import assert from "node:assert/strict";
import { test } from "node:test";
import { wantAPI } from "../../card-game/world.mjs";
import { reducers } from "./parity.mjs";

function check(wasm, world) {
  const candidate = wasm({ op: "visitor_reach", world });
  const actor = world.hidden.actor;
  assert.ok(
    candidate,
    `${actor} at ${world.actors[actor].place} was unsupported`,
  );
  assert.deepEqual(candidate, {
    ok: true,
    places: wantAPI(world).reachable(actor),
  });
  return candidate.places;
}

test("visitor geography follows each authored hiding place", async () => {
  const { pinned, wasm } = await reducers();
  const landings = new Set();
  for (const history of [false, true]) {
    for (const seed of [0, 1, 3, 4, 7, 11]) {
      const result = pinned({
        op: "create",
        seed,
        history,
        hidden: "nell",
        absent: ["mara"],
        homecoming: "ada",
      });
      assert.equal(result.ok, true, result.error);
      const { world } = result;
      landings.add(world.hidden.place);
      check(wasm, world);
    }
  }
  assert.equal(landings.size, 6);
});

test("visitor crossings respect reflection light and the bell signal", async () => {
  const { pinned, wasm } = await reducers();
  const forest = pinned({ op: "create", seed: 0, hidden: "nell" }).world;
  const lit = check(wasm, forest);
  assert.ok(lit.includes("attic"));
  assert.ok(!lit.includes("pond"));
  forest.items.lamp.lit = false;
  const dark = check(wasm, forest);
  assert.ok(dark.includes("pond"));
  assert.ok(dark.includes("station"));

  const clearing = pinned({ op: "create", seed: 4, hidden: "nell" }).world;
  assert.deepEqual(check(wasm, clearing), []);
  clearing.items.bell.ringing = 1;
  clearing.items.bell.holder = "pond";
  const ringing = check(wasm, clearing);
  assert.ok(ringing.includes("pond"));
  clearing.crossings["pond-clearing"].until = 1;
  forest.items.bell = clearing.items.bell;
  forest.crossings["pond-clearing"] = clearing.crossings["pond-clearing"];
  assert.ok(check(wasm, forest).includes("clearing"));

  forest.transports["greek-ship"].dock = "pond";
  forest.crossings["pond-greek-harbor"].discovered = true;
  assert.equal(wasm({ op: "visitor_reach", world: forest }), null);
});
