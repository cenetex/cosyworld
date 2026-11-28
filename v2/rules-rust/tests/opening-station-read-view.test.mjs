import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("reading the Keeper’s Log and reloading Station match the pinned replies", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  let sample;
  for (const [seed, dry, spoken, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
    [42, true, true, true],
    [4242, false, false, true],
    [4_294_967_295, true, false, false],
  ]) {
    let { world } = run({ op: "create", seed });
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      ({ world } = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }));
    }
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken) {
      ({ world } = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      }));
    }
    if (sorted)
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    const key = "read:vale:keeper-log:";
    const read = {
      ...seats,
      op: "play",
      world,
      action: sorted ? { key } : key,
    };
    const expectedRead = run(read);
    const actualRead = wasm(read);
    const differing = Object.keys(expectedRead.world).find(
      (field) =>
        !isDeepStrictEqual(actualRead?.world[field], expectedRead.world[field]),
    );
    assert.ok(
      isDeepStrictEqual(actualRead, expectedRead),
      `read ${seed} ${differing}`,
    );
    assert.deepEqual(
      actualRead.events.map(({ verb }) => verb),
      ["read", "wait"],
    );
    assert.equal(wasm({ ...read, revision: world.revision - 1 }), null);
    world = actualRead.world;
    assert.equal(wasm({ ...read, world }), null);
    for (const present of [["vale"], []]) {
      const request = { ...seats, op: "view", world, present };
      const expected = run(request);
      const actual = wasm(request);
      assert.ok(isDeepStrictEqual(actual, expected), `${seed}/${present}`);
      const train = actual.actions.findIndex(
        ({ key }) => key === "accept:vale::box:train",
      );
      assert.equal(actual.actions[train - 1].key, "accept:vale::keeper");
      assert.deepEqual(actual.world.speechVoices.vale, []);
      sample = request;
    }
  }
  for (const change of [
    (world) => {
      world.log.at(-1).actorId = "keeper";
    },
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.speechVoices.vale = ["keeper"];
    },
  ]) {
    const world = structuredClone(sample.world);
    change(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
