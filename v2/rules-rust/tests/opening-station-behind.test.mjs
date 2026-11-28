import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_move";
const behind = "behind-station";

function tracePrimary(source) {
  const marker = "    const sourceSeq = event.seq;";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `${marker}
    if (a.actor === "vale" && a.kind === "move" && a.target === "behind-station")
      globalThis.behindPrimary = structuredClone(s);`,
  );
}

test("Vale's first Behind the Station move preserves the exact primary frame", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(tracePrimary);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  for (const [seed, dry, spoken, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
    [17, true, true, true],
    [4242, false, false, true],
    [4_294_967_295, true, false, false],
  ]) {
    let world = run({ op: "create", seed });
    if (dry)
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    else
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken)
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      });
    if (sorted)
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    for (const key of [`move:vale::${behind}`, `move:vale:lamp:${behind}`]) {
      const request = {
        ...seats,
        op: "play",
        world,
        action: sorted ? { key } : key,
        revision: world.revision,
      };
      reference.behindPrimary = undefined;
      const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
      assert.equal(reply.ok, true, reply.error);
      const expected = JSON.parse(JSON.stringify(reference.behindPrimary));
      const actual = wasm({ ...request, op });
      const label = `${seed} ${key}`;
      assert.ok(actual?.ok, `unsupported ${label}`);
      const field = Object.keys(expected).find(
        (name) => !isDeepStrictEqual(actual.world[name], expected[name]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: expected }),
        `${label} ${field ?? "envelope"}`,
      );
      const event = actual.world.log.at(-1);
      assert.deepEqual(event.cast, ["vale"]);
      assert.deepEqual(event.witnesses.slice(0, 3), ["vale", "moth", "keeper"]);
      assert.equal(event.itemId, key.includes(":lamp:") ? "lamp" : null);
      assert.deepEqual(actual.world.arrival, {
        seq: event.seq,
        fromLocationId: "station",
        locationId: behind,
      });
      assert.deepEqual(
        actual.world.actors.vale.visited,
        world.actors.vale.visited,
      );
      assert.deepEqual(reply.world.actors.vale.visited, [
        ...world.actors.vale.visited,
        behind,
      ]);
      assert.equal(actual.world.items.lamp.fuel, world.items.lamp.fuel);
      assert.equal(wasm(request), null);
      sample = request;
    }
  }
  for (const mutate of [
    (world) => {
      world.actors.moth.place = behind;
    },
    (world) => {
      world.items.oil.holder = "vale";
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, op, world }), null);
  }
  const read = play(sample.world, "read:vale:keeper-log:");
  assert.equal(
    wasm({ ...sample, op, world: read, revision: read.revision }),
    null,
  );
  assert.equal(wasm({ ...sample, op, revision: sample.revision - 1 }), null);
});
