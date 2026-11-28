import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("quiet Station plays after authored history match full pinned replies", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) => ({ ...seats, op: "play", world, action });
  for (const seed of [undefined, 2, 42, 4242, 1, 17]) {
    const { world: saved } = run({ op: "create", history: true, seed });
    const { world: revived } = run({
      op: "create",
      save: JSON.stringify(saved),
    });
    for (const stowed of [false, true]) {
      let world = structuredClone(revived);
      if (stowed) {
        ({ world } = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }));
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const { world: pond } = run(play(world, "move:vale::pond"));
      for (const sorted of [false, true]) {
        const actors = sorted
          ? Object.fromEntries(Object.entries(pond.actors).toSorted())
          : pond.actors;
        const source = { ...pond, actors };
        const action = sorted
          ? { key: "move:vale:lamp:station" }
          : "move:vale::station";
        const request = play(source, action);
        const expected = run(request);
        const actual = wasm(request);
        if (seed === 1 || seed === 17) {
          assert.ok(expected.events.length > 1);
          assert.equal(actual, null);
        } else {
          const differing = Object.keys(expected.world).find(
            (key) =>
              !isDeepStrictEqual(actual?.world[key], expected.world[key]),
          );
          assert.ok(
            isDeepStrictEqual(actual, expected),
            `${seed}/${stowed}/${sorted}: ${differing}`,
          );
          assert.equal(actual.world.actors.moth.place, "pond");
          assert.equal(actual.world.actors.moth.sleeping.since, 481);
          assert.equal(actual.events.length, 1);
        }
      }
    }
  }
});
