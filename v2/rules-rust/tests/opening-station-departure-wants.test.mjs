import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_departure_wants";

function traceWants(source) {
  const start = "    reviseStalledWants(\n      next,";
  const end = "    fillWants(next, wantAPI(next));";
  const tail = "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";
  assert.equal(source.split(start).length, 2);
  assert.equal(source.split(end).length, 2);
  assert.equal(source.split(tail).length, 2);
  return source
    .replace(
      start,
      `    globalThis.beforeWants = structuredClone(next);\n${start}`,
    )
    .replace(end, `${end}\n    globalThis.afterWants = structuredClone(next);`)
    .replace(tail, `${tail}\n    globalThis.afterTail = structuredClone(next);`);
}

test("fresh Station departures settle wants without closing the Keeper quest", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceWants);
  const run = (request, reducer = pinned) => {
    const result = reducer(request);
    assert.equal(result.ok, true, result.error);
    return result.world;
  };
  const play = (world, key, useObject = false, reducer) =>
    run(
      {
        ...seats,
        op: "play",
        world,
        action: useObject ? { key } : key,
        revision: world.revision,
      },
      reducer,
    );
  const trace = (request) =>
    JSON.parse(reference.cardShared(JSON.stringify(request)));
  const capture = (name) => JSON.parse(JSON.stringify(reference[name]));
  let sample;
  for (const seed of [undefined, 2, 17, 42, 4242]) {
    for (const dry of [false, true]) {
      let world = run({ op: "create", seed });
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      } else {
        world = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
      }
      world = play(world, "move:vale::pond");
      world = play(
        world,
        dry ? "move:vale:lamp:station" : "move:vale::station",
      );
      for (const to of ["behind-station", "pond"]) {
        let before = world;
        if (to === "pond") {
          before = play(before, "read:vale:keeper-log:");
          before = play(before, "accept:vale::keeper");
        }
        const key = `move:vale:${dry ? "lamp" : ""}:${to}`;
        play(before, key, dry, trace);
        const request = { op, before, world: capture("beforeWants") };
        const expected = capture("afterWants");
        const actual = wasm(request);
        const differingField = Object.keys(expected).find(
          (key) => !isDeepStrictEqual(actual?.world[key], expected[key]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: expected }),
          `${seed} ${to} dry=${dry}: ${actual ? differingField : "unsupported"}`,
        );
        assert.deepEqual(
          actual.world.actors.vale.want,
          before.actors.vale.want,
        );
        assert.equal(actual.world.actors.moth.want.refusals, 1);
        assert.equal(
          actual.world.actors["greek-aethra"].want.since,
          actual.world.turn,
        );
        const tail = wasm({
          op: "opening_second_attic_tail",
          phase: "station_departure_after_wants",
          before,
          world: actual.world,
        });
        const after = capture("afterTail");
        const tailField = Object.keys(after).find(
          (field) => !isDeepStrictEqual(tail?.world[field], after[field]),
        );
        assert.ok(
          isDeepStrictEqual(tail, { ok: true, world: after }),
          `${seed} ${to} dry=${dry}: tail ${tail ? tailField : "unsupported"}`,
        );
        if (to === "pond") sample = request;
      }
    }
  }
  for (const change of [
    ({ before }) => {
      before.eventSeq -= 1;
    },
    ({ before }) => {
      before.knowledge.known.vale["quest:keeper:pond"].learnedTurn = 2;
    },
    ({ world }) => {
      world.presentActors = [];
    },
    ({ world }) => {
      world.actors.vale.want = null;
    },
    ({ world }) => {
      world.log.at(-1).actorId = "moth";
    },
  ]) {
    const request = structuredClone(sample);
    change(request);
    assert.equal(wasm(request), null);
  }
});
