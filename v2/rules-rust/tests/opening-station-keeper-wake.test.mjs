import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wake = { op: "opening_station_residents", resident: "keeper" };

function traceKeeper(source) {
  const condition =
    'id === "keeper" && s.began === 480 && s.actors.vale.place === "station" && s.turn === 482';
  for (const [frame, marker] of [
    ["beforeKeeper", "      const a = s.actors[id], z = a.sleeping;"],
    [
      "afterKeeper",
      "        continue;\n      }\n      const w = bedtime(s, id);",
    ],
  ]) {
    assert.equal(source.split(marker).length, 2, frame);
    source = source.replace(
      marker,
      `      if (${condition}) globalThis.${frame} = structuredClone(s);\n${marker}`,
    );
  }
  return source;
}

test("Keeper's scheduled wake matches the historic Station narration and memories", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceKeeper);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const seed of [17, 99]) {
    const fresh = run({ op: "create", history: true, seed });
    const reopened = run({ op: "create", save: JSON.stringify(fresh) });
    const stowed = run({
      ...seats,
      op: "hold",
      world: reopened,
      choice: { item: null, revision: reopened.revision },
    });
    const pond = run({
      ...seats,
      op: "play",
      world: stowed,
      action: "move:vale::pond",
    });
    const sorted = Object.fromEntries(Object.entries(pond.actors).toSorted());
    for (const actors of [pond.actors, sorted]) {
      for (const key of ["move:vale::station", "move:vale:lamp:station"]) {
        reference.beforeKeeper = reference.afterKeeper = undefined;
        const reply = JSON.parse(
          reference.cardShared(
            JSON.stringify({
              ...seats,
              op: "play",
              world: { ...pond, actors },
              action: actors === sorted ? { key } : key,
            }),
          ),
        );
        assert.equal(reply.ok, true, reply.error);
        const before = JSON.parse(JSON.stringify(reference.beforeKeeper));
        const after = JSON.parse(JSON.stringify(reference.afterKeeper));
        const label = `${seed} ${key} ${actors === sorted ? "sorted" : "authored"}`;
        assert.deepEqual(before.actors.keeper.sleeping, {
          since: 481,
          place: "station",
          until: 482,
        });
        assert.equal(before.log.at(-1).actorId, seed === 17 ? "orin" : "moth");
        assert.equal(after.actors.keeper.sleeping, undefined);
        assert.equal(after.actors.keeper.slept, before.actors.keeper.slept);
        const event = after.log.at(-1);
        assert.equal(event.seq, before.eventSeq + 1);
        assert.equal(event.actorId, "keeper");
        assert.equal(event.text, "The keeper wakes.");
        assert.deepEqual(
          event.cast,
          actors === sorted
            ? ["keeper", "moth", "vale"]
            : ["vale", "moth", "keeper"],
        );
        for (const id of ["vale", "moth", "keeper", "keeper-log"])
          assert.notDeepEqual(before.memories[id], after.memories[id]);
        const actual = wasm({ ...wake, world: before });
        assert.ok(actual?.ok, `unsupported ${label}`);
        const field = Object.keys(after).find(
          (name) => !isDeepStrictEqual(actual.world[name], after[name]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label} ${field ?? "envelope"}`,
        );
        assert.equal(wasm({ ...wake, world: after }), null);
        sample = before;
      }
    }
  }
  for (const mutate of [
    (world) => {
      world.actors.keeper.sleeping.until = 483;
    },
    (world) => {
      world.log = world.log.filter(
        (event) => event.seq !== world.arrival.seq + 1,
      );
    },
    (world) => {
      world.actors.mara.place = "station";
    },
  ]) {
    const world = structuredClone(sample);
    mutate(world);
    assert.equal(wasm({ ...wake, world }), null);
  }
});
