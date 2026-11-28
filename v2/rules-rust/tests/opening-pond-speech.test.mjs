import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const voices = [
  { actorId: "vale", text: "  The shore feels close. " },
  { entityId: "moth", text: "Listen to the water." },
  { entityId: "pond", text: "Ripples spread from the reeds." },
];

function run(pinned, request) {
  const result = pinned(request);
  assert.equal(result.ok, true, result.error);
  return result;
}

function request(world, lines = voices) {
  return { ...seats, op: "speech", world, room: "pond", entries: [], lines };
}

function moved(pinned, seed, mode, afterWait) {
  let { world } = run(pinned, { op: "create", seed });
  if (mode === "stowed") {
    ({ world } = run(pinned, {
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    }));
  } else {
    Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
  }
  if (afterWait) {
    ({ world } = run(pinned, {
      ...seats,
      op: "play",
      world,
      action: "wait:vale::",
    }));
    ({ world } = run(pinned, {
      ...request(world, [{ entityId: "attic", text: "The floor settles." }]),
      room: "attic",
    }));
  }
  return run(pinned, {
    ...seats,
    op: "play",
    world,
    action: mode === "dry" ? "move:vale:lamp:pond" : "move:vale::pond",
  });
}

test("Vale and Pip publish the complete pinned second-Move speech reply", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 2, 4242]) {
    for (const mode of ["stowed", "dry"]) {
      const played = moved(pinned, seed, mode, true);
      assert.equal(played.world.turn, 2);
      assert.deepEqual(played.world.speechVoices.vale, ["vale", "moth"]);
      assert.deepEqual(
        played.events
          .filter(({ locationId }) => locationId === "pond")
          .map(({ actorId, verb }) => [actorId, verb]),
        [
          ["vale", "move"],
          ["moth", "ask"],
        ],
      );
      const sorted = Object.fromEntries(
        Object.entries(played.world.actors).toSorted(),
      );
      for (const actors of [played.world.actors, sorted]) {
        const world = { ...played.world, actors };
        const speech = request(world);
        if (actors === sorted) {
          speech.present = [];
          delete speech.room;
        }
        const expected = run(pinned, speech);
        const actual = wasm(speech);
        const label = JSON.stringify({ seed, mode, present: speech.present });
        assert.ok(isDeepStrictEqual(actual, expected), label);
        assert.equal(actual.world.revision, world.revision + 1);
        assert.equal(actual.lines[0].seq, world.eventSeq + 1);
        assert.ok(actual.lines.every(({ light }) => !light));
        const last = actual.lines.at(-1).seq;
        for (const [viewer, other] of [
          ["vale", "moth"],
          ["moth", "vale"],
        ]) {
          assert.deepEqual(
            actual.world.memories[viewer].subjects,
            world.memories[viewer].subjects,
          );
          assert.equal(actual.world.memories[viewer].seen[other].seq, last);
        }
        const repeat = request(actual.world, [voices[1]]);
        assert.ok(
          isDeepStrictEqual(wasm(repeat), run(pinned, repeat)),
          `repeat ${label}`,
        );
      }
    }
  }
});

test("out-of-room and first-Move pond speech stay with the pinned reducer", async () => {
  const { pinned, wasm } = await reducers();
  const first = moved(pinned, 2, "stowed", false);
  assert.equal(run(pinned, request(first.world)).lines.length, 3);
  assert.equal(wasm(request(first.world)), null);
  const second = moved(pinned, 2, "stowed", true);
  const outside = {
    ...request(second.world, voices.slice(0, 2)),
    room: "attic",
  };
  assert.equal(pinned(outside).ok, false);
  assert.equal(wasm(outside), null);
  const keeper = request(second.world, [
    { actorId: "keeper", text: "Stay here." },
  ]);
  assert.equal(pinned(keeper).ok, false);
  assert.equal(wasm(keeper), null);
});
