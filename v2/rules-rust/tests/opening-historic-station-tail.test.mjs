import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_second_attic_tail";
const phase = "historic_station";

function captureTail(source) {
  for (const [name, line] of [
    ["beforeWants", "    reviseStalledWants(\n      next,"],
    ["before", "    settleHomeLevels(next);"],
    ["after", "    validateWorld(next);\n    let slept = next;"],
  ]) {
    assert.equal(source.split(line).length, 2, name);
    source = source.replace(
      line,
      `    if (next.turn === 482 && next.actors.vale.place === "station") globalThis.tail.${name} = structuredClone(next);\n${line}`,
    );
  }
  return source;
}

test("the historic Station tail reproduces the full pinned saved world", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureTail);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  let awakeSample;
  for (const [seed, dry] of [
    [undefined, false], [2, false], [42, false], [4242, false],
    [17, false], [17, true], [99, false], [99, true],
  ]) {
    const saved = run({ op: "create", history: true, seed });
    const revived = run({ op: "create", save: JSON.stringify(saved) });
    let ready = revived;
    if (dry) {
      Object.assign(ready.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      ready = run({
        ...seats,
        op: "hold",
        world: revived,
        choice: { item: null, revision: revived.revision },
      });
    }
    const pond = run({
      ...seats,
      op: "play",
      world: ready,
      action: "move:vale::pond",
    });
    for (const sorted of [false, true]) {
      const actors = sorted
        ? Object.fromEntries(Object.entries(pond.actors).toSorted())
        : pond.actors;
      const source = { ...pond, actors };
      reference.tail = {};
      const action = sorted
        ? { key: "move:vale:lamp:station" }
        : "move:vale::station";
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({ ...seats, op: "play", world: source, action }),
        ),
      );
      assert.equal(reply.ok, true, reply.error);
      const { beforeWants, before, after } = JSON.parse(JSON.stringify(reference.tail));
      const label = `${seed} dry=${dry} sorted=${sorted}`;
      const wants = { op: "opening_station_wants", world: beforeWants };
      const settled = wasm(wants);
      const wantDifference = Object.keys(before).find(
        (key) => !isDeepStrictEqual(settled?.world[key], before[key]),
      );
      assert.ok(isDeepStrictEqual(settled, { ok: true, world: before }), `${label} wants ${wantDifference}`);
      const request = { op, phase, before: source, world: before };
      const actual = wasm(request);
      const differing = Object.keys(after).find(
        (key) => !isDeepStrictEqual(actual?.world[key], after[key]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: after }),
        `${label} tail ${differing}`,
      );
      assert.deepEqual(actual.world.actors.vale.waitSpeech, {
        place: "station",
        turn: null,
      });
      if (seed === 17 || seed === 99) {
        assert.equal(actual.world.actors.moth.place, "station");
        assert.equal(actual.world.actors.keeper.sleeping, undefined);
        assert.equal(actual.world.log.at(-1).text, "The keeper wakes.");
        assert.deepEqual(
          reply.events.map(({ actorId }) => actorId),
          seed === 99 ? ["vale", "moth", "ada", "keeper"] : ["vale", "moth", "keeper"],
        );
        if (seed === 99) awakeSample = { wants, request };
      } else {
        sample = request;
      }
    }
  }
  for (const change of [
    (request) => {
      request.before.eventSeq -= 1;
    },
    (request) => {
      request.world.actors.moth.sleeping.since -= 1;
    },
    (request) => {
      request.world.actors.vale.arcana = { offer: "pond" };
    },
  ]) {
    const request = structuredClone(sample);
    change(request);
    assert.equal(wasm(request), null);
  }
  for (const change of [
    (world) => { world.log.at(-1).actorId = "moth"; },
    (world) => { world.log.at(-2).fromLocationId = "station"; },
    (world) => { world.actors.moth.visited.pop(); },
  ]) {
    for (const saved of [awakeSample.request, awakeSample.wants]) {
      const request = structuredClone(saved);
      change(request.world);
      assert.equal(wasm(request), null);
    }
  }
});
