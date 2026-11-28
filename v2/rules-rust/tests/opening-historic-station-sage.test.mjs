import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const moveSage = { op: "opening_visitor_play", actor: "ada" };

function traceSage(source) {
  const marker =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `      const chosen = read2 ?? plan(next, id).action;
      const capture = id === "ada" && next.turn === 482 && next.actors.vale.place === "station";
      if (capture) globalThis.sage = { key: chosen.key, before: structuredClone(next) };
      perform(next, chosen, round2, residents2);
      if (capture) globalThis.sage.after = structuredClone(next);`,
  );
}

test("Sage leaves the shears in the loft when crossing to the docked ship", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceSage);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const seed = 99;
  const created = run({ op: "create", history: true, seed });
  const saved = run({ op: "create", save: JSON.stringify(created) });
  let sample;
  for (const dry of [false, true]) {
    let world = structuredClone(saved);
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
    }
    const pond = run({
      ...seats,
      op: "play",
      world,
      action: "move:vale::pond",
    });
    for (const sorted of [false, true]) {
      const actors = sorted
        ? Object.fromEntries(Object.entries(pond.actors).toSorted())
        : pond.actors;
      const key = dry ? "move:vale:lamp:station" : "move:vale::station";
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: { ...pond, actors },
            action: sorted ? { key } : key,
          }),
        ),
      );
      assert.equal(reply.ok, true, reply.error);
      const {
        key: picked,
        before,
        after,
      } = JSON.parse(JSON.stringify(reference.sage));
      const label = `dry=${dry}, sorted=${sorted}`;
      const actual = wasm({ ...moveSage, world: before });
      assert.equal(picked, "move:ada::greek-ship", label);
      assert.ok(actual?.ok, `unsupported ${label}`);
      const field = Object.keys(after).find(
        (name) => !isDeepStrictEqual(actual.world[name], after[name]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: after }),
        `${label} ${field}`,
      );
      assert.equal(after.items.shears.holder, "loft");
      assert.equal(after.actors.ada.dwellUntil, undefined);
      assert.equal(after.transports["greek-ship"].since, 482);
      assert.deepEqual(after.transports["greek-ship"].riders, []);
      assert.deepEqual(after.log.at(-1).witnesses, ["ada", "shears"]);
      sample = before;
    }
  }
  for (const change of [
    (world) => {
      world.items.shears.holder = "loft";
    },
    (world) => {
      world.doors.loft = "forest-cottage";
    },
    (world) => {
      world.transports["greek-ship"].phase = "sea";
    },
    (world) => {
      world.log.at(-1).fromLocationId = "attic";
    },
  ]) {
    const world = structuredClone(sample);
    change(world);
    assert.equal(wasm({ ...moveSage, world }), null);
  }
});
