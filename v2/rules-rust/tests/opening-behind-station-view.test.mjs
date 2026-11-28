import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const room = "behind-station";

test("first quiet yard arrival and private reloads match pinned replies", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const result = pinned(request);
    assert.equal(result.ok, true, result.error);
    return result;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let last;
  let wayfinderCases = 0;
  for (const seed of [undefined, 2, 17, 42, 4242]) {
    for (const dry of [false, true]) {
      let { world } = run({ op: "create", seed });
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      } else {
        ({ world } = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }));
      }
      ({ world } = play(world, "move:vale::pond"));
      ({ world } = play(
        world,
        dry ? "move:vale:lamp:station" : "move:vale::station",
      ));
      const key = dry
        ? "move:vale:lamp:behind-station"
        : "move:vale::behind-station";
      const expected = play(world, dry ? { key } : key);
      const label = `${seed} dry ${dry}`;
      const completed = wasm({
        ...seats,
        op: "opening_behind_station_view",
        beforeSeq: world.eventSeq,
        world: { ...expected.world, speechVoices: world.speechVoices },
      });
      assert.ok(isDeepStrictEqual(completed, expected), `completed ${label}`);
      assert.deepEqual(completed.exits, ["station"]);
      assert.deepEqual(completed.world.speechVoices.vale, ["vale"]);
      wayfinderCases += Number(
        completed.actions.some(
          ({ key }) => key === "take:vale:elysium-wayfinder:",
        ),
      );
      const spoken = run({
        ...seats,
        op: "speech",
        room,
        world: expected.world,
        lines: [
          { actorId: "vale", text: "The stone is wet." },
          { entityId: room, text: "Rain drips by the lock." },
        ],
      }).world;
      assert.equal(spoken.eventSeq, expected.world.eventSeq + 2);
      for (const saved of [expected.world, spoken]) {
        for (const present of [seats.present, []]) {
          last = { ...seats, op: "view", world: saved, present };
          const viewed = wasm(last);
          assert.ok(
            isDeepStrictEqual(viewed, run(last)),
            `view ${label} ${present.length} published ${saved === spoken}`,
          );
          assert.deepEqual(viewed.world.memories.vale, saved.memories.vale);
          assert.equal(viewed.world.memories.moth.learning, undefined);
          assert.ok(!Object.hasOwn(viewed, "events"));
        }
      }
    }
  }
  assert.ok(wayfinderCases > 0 && wayfinderCases < 10);
  assert.equal(wasm({ ...last, claimed: ["vale", "mara"] }), null);
  for (const change of [
    (world) => {
      world.arrival.fromLocationId = "pond";
    },
    (world) => {
      world.actors.moth.place = room;
    },
    (world) => {
      world.items["ratiradio-station-key"].holder = "vale";
    },
    (world) => {
      world.log.at(-1).actorId = "keeper";
    },
  ]) {
    const world = structuredClone(last.world);
    change(world);
    assert.equal(wasm({ ...last, world }), null);
  }
});
