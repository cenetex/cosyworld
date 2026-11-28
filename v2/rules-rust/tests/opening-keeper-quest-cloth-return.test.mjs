import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_move";

function tracePrimary(source) {
  const marker =
    "    const respondent = perform(next, exact, round2, residents2);";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `${marker}
    if (actor === "vale" && exact.kind === "move" && exact.target === "pond" && next.turn === 6)
      globalThis.clothReturn = structuredClone(next);`,
  );
}

test("Vale returns to Pond carrying Pip's cloth and the Keeper's quest", async () => {
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
    [17, false, false, true],
    [42, true, true, true],
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
    for (const action of [
      "move:vale::pond",
      "move:vale::station",
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
    ])
      world = play(world, action);
    if (spoken)
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [
          { actorId: "vale", text: "I should take this cloth to the pond." },
        ],
      });
    if (sorted)
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    for (const key of ["move:vale::pond", "move:vale:lamp:pond"]) {
      const request = {
        ...seats,
        op: "play",
        world,
        action: sorted ? { key } : key,
        revision: world.revision,
      };
      reference.clothReturn = undefined;
      const completed = JSON.parse(
        reference.cardShared(JSON.stringify(request)),
      );
      assert.equal(completed.ok, true, completed.error);
      const expected = JSON.parse(JSON.stringify(reference.clothReturn));
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
      assert.equal(event.actorId, "vale");
      assert.equal(event.fromLocationId, "station");
      assert.equal(event.locationId, "pond");
      assert.equal(event.itemId, key.includes(":lamp:") ? "lamp" : null);
      assert.deepEqual(actual.world.actors.vale.want, world.actors.vale.want);
      assert.deepEqual(
        actual.world.actors.vale.visited,
        world.actors.vale.visited,
      );
      assert.deepEqual(actual.world.life, world.life);
      assert.equal(actual.world.actors.vale.heldItem, "cloth");
      for (const id of ["cloth", "lamp"]) {
        const item = actual.world.items[id];
        assert.equal(item.holder, "vale");
        assert.equal(
          item.history.at(-1),
          "Turn 6: Vale carried it to Black pond.",
        );
      }
      assert.deepEqual(completed.events, [event]);
      sample = { ...request, op };
    }
  }
  for (const mutate of [
    (world) => {
      world.actors.vale.want = null;
    },
    (world) => {
      world.arrival.fromLocationId = "attic";
    },
    (world) => {
      world.actors.rue.place = "station";
    },
    (world) => {
      delete world.life.actors.vale.attachments.cloth;
    },
    (world) => {
      const gift = world.log.findLast(({ verb }) => verb === "give");
      gift.accepted = false;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
});
