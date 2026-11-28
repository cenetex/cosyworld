import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const ship = "greek-ship";
const key = "wait:vale::";

function captureWait(source) {
  const primary =
    "    const respondent = perform(next, exact, round2, residents2);";
  assert.equal(source.split(primary).length, 2);
  return source.replace(
    primary,
    "$&\n    if (next.turn === 10) globalThis.waited = structuredClone(next);",
  );
}

test("the first shipboard Wait matches pinned action evidence", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(captureWait);
  const captured = (name) => JSON.parse(JSON.stringify(reference[name]));
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  let sample;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const ordered of [false, true]) {
      let world = run({ op: "create", seed }).world;
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }).world;
      for (const action of [
        "move:vale::pond",
        "move:vale::station",
        "read:vale:keeper-log:",
        "accept:vale::keeper",
        "move:vale::pond",
        "move:vale::station",
        "move:vale::pond",
      ])
        world = play(world, action);
      if (ordered)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      world = play(world, "drop:vale:lamp:pond");
      world = play(
        world,
        ordered ? "move:vale:cloth:greek-ship" : "move:vale::greek-ship",
      );
      world = play(world, "course:vale::greek-harbor");
      const request = {
        ...seats,
        op: "play",
        world,
        action: ordered ? { key } : key,
        revision: world.revision,
      };
      const reply = run(request);
      const waited = captured("waited");
      const label = `${seed} ${ordered}`;
      sample = { ...request, op: "opening_pond_ship_wait" };
      assert.ok(
        isDeepStrictEqual(wasm(sample), { ok: true, world: waited }),
        `waited ${label}`,
      );
      assert.deepEqual(reply.events[0], waited.log.at(-1));
      assert.deepEqual(waited.transports[ship], world.transports[ship]);
      assert.deepEqual(waited.actors.vale, world.actors.vale);
      assert.deepEqual(waited.arrival, world.arrival);
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, action: "wait:vale::sleep" }), null);
  for (const mutate of [
    (world) => {
      world.transports[ship].destination = "pond";
    },
    (world) => {
      world.actors.rue.place = ship;
    },
    (world) => {
      world.log.at(-1).generated = true;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
