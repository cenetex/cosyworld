import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("quiet Pond-to-Station plays return the complete pinned reply", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => ({ ...seats, op: "play", world, action });
  let sample;
  for (const seed of [undefined, 0, 2, 7, 17, 42, 99, 4242, 4_294_967_295]) {
    for (const waited of [false, true]) {
      if (waited && (seed === 7 || seed === 99)) continue;
      for (const stowed of [false, true]) {
        let world = run({ op: "create", seed });
        if (stowed) {
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
        if (waited) world = run(play(world, "wait:vale::"));
        world = run(play(world, "move:vale::pond"));
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
          const sorted = seed === 2 || seed === 99 || seed === 4242;
          const actors = sorted
            ? Object.fromEntries(Object.entries(prior.actors).toSorted())
            : prior.actors;
          const request = play({ ...prior, actors }, sorted ? { key } : key);
          const expected = pinned(request);
          const actual = wasm(request);
          const label = `${seed} ${waited} ${stowed} ${key}`;
          assert.equal(expected.ok, true, expected.error);
          assert.ok(actual?.ok, `unsupported ${label}`);
          const field = Object.keys(expected).find(
            (name) => !isDeepStrictEqual(actual[name], expected[name]),
          );
          const part = Object.keys(expected.world).find(
            (name) =>
              !isDeepStrictEqual(actual.world[name], expected.world[name]),
          );
          assert.ok(
            isDeepStrictEqual(actual, expected),
            `${label} ${field} ${part}`,
          );
          if (
            expected.events.some(
              ({ actorId, verb, locationId }) =>
                actorId === "rue" &&
                verb === "move" &&
                locationId === "station",
            )
          ) {
            assert.deepEqual(actual.world.speechVoices.vale, [
              "vale",
              "keeper",
              "rue",
            ]);
            assert.equal(actual.world.packs["shared-homes"].met.rue, 2);
          }
          sample = request;
        }
      }
    }
  }
  for (const change of [
    (request) => {
      request.revision = request.world.revision - 1;
    },
    (request) => {
      request.present.push("moth");
    },
    (request) => {
      request.world.actors.vale.visited.pop();
    },
  ]) {
    const request = structuredClone(sample);
    change(request);
    assert.equal(wasm(request), null);
  }
});
