import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_move";

function tracePrimary(source) {
  const marker = "    const sourceSeq = event.seq;";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `${marker}
    if (a.actor === "vale" && a.kind === "move" && a.target === "pond" && s.turn === 4)
      globalThis.pondReturn = structuredClone(s);`,
  );
}

test("Vale's first return to Pond keeps the accepted Keeper quest and lamp state", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(tracePrimary);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  let complete;
  let view;
  for (const [seed, dry, spoken, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
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
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken)
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      });
    const read = play(world, "read:vale:keeper-log:");
    const accepted = play(read, "accept:vale::keeper");
    assert.equal(accepted.turn, 3);
    assert.equal(accepted.actors.vale.want.from, "quest:from:keeper");
    if (sorted)
      accepted.actors = Object.fromEntries(
        Object.entries(accepted.actors).toSorted(),
      );
    for (const key of ["move:vale::pond", "move:vale:lamp:pond"]) {
      const request = {
        ...seats,
        op: "play",
        world: accepted,
        action: sorted ? { key } : key,
        revision: accepted.revision,
      };
      reference.pondReturn = undefined;
      const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
      assert.equal(reply.ok, true, reply.error);
      const expected = JSON.parse(JSON.stringify(reference.pondReturn));
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
      assert.equal(event.fromLocationId, "station");
      assert.equal(event.itemId, key.includes(":lamp:") ? "lamp" : null);
      assert.deepEqual(actual.world.arrival, {
        seq: event.seq,
        fromLocationId: "station",
        locationId: "pond",
      });
      assert.deepEqual(
        actual.world.actors.vale.want,
        accepted.actors.vale.want,
      );
      assert.deepEqual(
        actual.world.actors.vale.visited,
        accepted.actors.vale.visited,
      );
      assert.equal(actual.world.items.lamp.fuel, accepted.items.lamp.fuel);
      const completed = wasm(request);
      const completedField = Object.keys(reply).find(
        (field) => !isDeepStrictEqual(completed?.[field], reply[field]),
      );
      assert.ok(
        isDeepStrictEqual(completed, reply),
        `${label} complete ${completed ? completedField : "unsupported"}`,
      );
      complete = {
        ...seats,
        op: "opening_pond_return_view",
        beforeSeq: accepted.eventSeq,
        world: { ...reply.world, speechVoices: accepted.speechVoices },
      };
      assert.ok(isDeepStrictEqual(wasm(complete), reply), `complete ${label}`);
      assert.deepEqual(reply.exits, ["station"]);
      assert.deepEqual(reply.world.speechVoices.vale, ["vale"]);
      assert.equal(reply.actions.at(-1).key, "drop:vale:::0");
      assert.ok(reply.actions.every(({ target }) => target !== "moth"));
      const published = run({
        ...seats,
        op: "speech",
        room: "pond",
        world: reply.world,
        lines: [
          { actorId: "vale", text: "The pond is quiet." },
          { entityId: "pond", text: "Rain trembles on the water." },
        ],
      });
      for (const world of [reply.world, published]) {
        for (const present of [seats.present, []]) {
          view = { ...seats, op: "view", world, present };
          const projected = wasm(view);
          const expected = pinned(view);
          assert.ok(
            isDeepStrictEqual(projected, expected),
            `private ${label} ${present.length} ${world === published}`,
          );
          assert.equal(projected.world.memories.moth.learning, undefined);
          assert.deepEqual(projected.world.memories.vale, world.memories.vale);
          assert.ok(!Object.hasOwn(projected, "events"));
        }
      }
      sample = request;
    }
    assert.equal(
      wasm({ ...sample, op, world: read, revision: read.revision }),
      null,
    );
  }
  for (const mutate of [
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.actors.moth.place = "pond";
    },
    (world) => {
      world.items.oil.holder = "vale";
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, op, world }), null);
  }
  assert.equal(wasm({ ...sample, op, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...complete, beforeSeq: complete.beforeSeq - 1 }), null);
  for (const mutate of [
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.actors.moth.place = "pond";
    },
    (world) => {
      world.crossings["pond-greek-harbor"].discovered = true;
    },
    (world) => {
      world.items.lamp.lit = true;
    },
    (world) => {
      world.items["greek-water-jar"].holder = "pond";
    },
  ]) {
    const world = structuredClone(view.world);
    mutate(world);
    assert.equal(wasm({ ...view, world }), null);
  }
});
