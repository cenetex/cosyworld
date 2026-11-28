import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("fresh Station Presence preserves both pinned arrival horizons and Rue's meeting", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let firstArrival;
  let rueArrival;
  for (const [seed, waited, dry, rueTarget] of [
    [undefined, false, false, null],
    [undefined, true, false, null],
    [2, false, true, null],
    [2, true, true, null],
    [7, false, false, "moth"],
    [99, false, true, "vale"],
  ]) {
    let world = run({ op: "create", seed });
    const rue = rueTarget !== null;
    if (rue) {
      world.actors.rue.want = {
        kind: "person",
        target: rueTarget,
        since: 0,
        refusals: 0,
      };
    }
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      world = run({
        ...seats, op: "hold", world,
        choice: { item: null, revision: world.revision },
      });
    }
    if (waited) world = run({ ...seats, op: "play", world, action: "wait:vale::" });
    world = run({ ...seats, op: "play", world, action: "move:vale::pond" });
    if (dry || waited) {
      world.actors = Object.fromEntries(Object.entries(world.actors).toSorted());
    }
    const key = dry ? "move:vale:lamp:station" : "move:vale::station";
    world = run({ ...seats, op: "play", world, action: key });
    assert.equal(world.turn, waited ? 3 : 2);
    assert.equal(world.actors.rue.place === "station", rue);
    if (rue) rueArrival = world;
    else if (!waited) firstArrival = world;
    const spoken = run({
      ...seats, op: "speech", room: "station", world,
      lines: [{ actorId: rue ? "rue" : "keeper", text: "The platform is quiet." }],
    });
    for (const saved of [world, spoken]) {
      const expected = { ok: true, world: saved };
      let prior = saved;
      for (const [claimed, present] of [
        [["vale"], []], [["vale"], ["vale"]], [[], []],
      ]) {
        const request = { ...seats, op: "presence", world: prior, claimed, present };
        const label = JSON.stringify({ seed, waited, dry, rue, spoken: saved === spoken, claimed, present });
        assert.ok(isDeepStrictEqual(pinned(request), expected), label);
        const actual = wasm(request);
        assert.ok(isDeepStrictEqual(actual, expected), label);
        prior = actual.world;
      }
    }
  }
  const presence = { ...seats, op: "presence", present: [] };
  const corrupted = structuredClone(rueArrival);
  corrupted.log.findLast((entry) => entry.actorId === "rue" && entry.verb === "move").witnesses = ["vale"];
  assert.equal(wasm({ ...presence, world: corrupted }), null);
  for (const action of ["accept:vale::box:train", "read:vale:keeper-log:"]) {
    const world = run({ ...seats, op: "play", world: firstArrival, action });
    assert.equal(wasm({ ...presence, world }), null);
  }
});
