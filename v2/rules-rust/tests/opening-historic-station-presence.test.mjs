import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("leaving, re-entering and releasing Vale at historic Station match pinned replies", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const seed of [17, 99]) {
    const created = run({ op: "create", history: true, seed });
    for (const dry of [false, true]) {
      let world = run({ op: "create", save: JSON.stringify(created) });
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      } else {
        world = run({
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        });
      }
      world = run({ ...seats, op: "play", world, action: "move:vale::pond" });
      if (dry) world.actors = Object.fromEntries(Object.entries(world.actors).toSorted());
      const key = dry ? "move:vale:lamp:station" : "move:vale::station";
      world = run({ ...seats, op: "play", world, action: key });
      assert.equal(world.actors.moth.place, "station");
      const spoken = run({
        ...seats, op: "speech", room: "station", world,
        lines: [{ actorId: "keeper", text: "The next train can wait." }],
      });
      for (const saved of [world, spoken]) {
        const original = { ok: true, world: saved };
        let prior = saved;
        for (const [claimed, present] of [
          [["vale"], []], [["vale"], ["vale"]], [[], []],
        ]) {
          const request = { ...seats, op: "presence", world: prior, claimed, present };
          const expected = pinned(request);
          const actual = wasm(request);
          const label = JSON.stringify({ seed, dry, spoken: saved === spoken, claimed, present });
          assert.ok(isDeepStrictEqual(expected, original), label);
          assert.ok(isDeepStrictEqual(actual, expected), label);
          prior = actual.world;
          sample = request;
        }
      }
    }
  }
  assert.equal(wasm({ ...sample, present: ["vale"] }), null);
  assert.equal(wasm({ ...sample, claimed: ["vale", "mara"] }), null);
  const changed = structuredClone(sample.world);
  changed.log.findLast((entry) => entry.text === "The keeper wakes.").actorId = "moth";
  assert.equal(wasm({ ...sample, world: changed }), null);
});
