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
  for (const seed of [undefined, 2, 42, 4242]) {
    const saved = run({ op: "create", history: true, seed });
    const revived = run({ op: "create", save: JSON.stringify(saved) });
    const stowed = run({
      ...seats,
      op: "hold",
      world: revived,
      choice: { item: null, revision: revived.revision },
    });
    const pond = run({
      ...seats,
      op: "play",
      world: stowed,
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
      const { before, after } = JSON.parse(JSON.stringify(reference.tail));
      const request = { op, phase, before: source, world: before };
      const actual = wasm(request);
      const differing = Object.keys(after).find(
        (key) => !isDeepStrictEqual(actual?.world[key], after[key]),
      );
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: after }),
        `${seed} ${sorted} ${differing}`,
      );
      assert.deepEqual(actual.world.actors.vale.waitSpeech, {
        place: "station",
        turn: null,
      });
      sample = request;
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
});
