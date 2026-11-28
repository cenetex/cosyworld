import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const lines = [
  { actorId: "vale", text: "  The timetable is still here. " },
  { entityId: "keeper", text: "The next train can wait." },
  { entityId: "station", text: "Wind passes beneath the platform." },
];

function run(pinned, request) {
  const reply = pinned(request);
  assert.equal(reply.ok, true, reply.error);
  return reply;
}

function arrive(pinned, seed, dry, sorted) {
  let { world } = run(pinned, { op: "create", seed, history: true });
  if (dry)
    Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
  else
    ({ world } = run(pinned, {
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    }));
  ({ world } = run(pinned, {
    ...seats,
    op: "play",
    world,
    action: "move:vale::pond",
  }));
  if (sorted) {
    ({ world } = run(pinned, {
      ...seats,
      op: "speech",
      world,
      room: "pond",
      lines: [{ entityId: "pond", text: "The water stills." }],
    }));
    world.actors = Object.fromEntries(Object.entries(world.actors).toSorted());
  }
  return run(pinned, {
    ...seats,
    op: "play",
    world,
    action: dry ? "move:vale:lamp:station" : "move:vale::station",
  }).world;
}

test("turn-482 Station speech keeps the keeper's cue and reloads its private view", async () => {
  const { pinned, wasm } = await reducers();
  let saved;
  for (const seed of [undefined, 2, 42, 4242]) {
    for (const sorted of [false, true]) {
      const world = arrive(pinned, seed, sorted, sorted);
      assert.equal(world.turn, 482);
      assert.ok(world.actors.moth.sleeping);
      assert.equal(Boolean(world.actors.keeper.sleeping), seed === 4242);
      assert.deepEqual(world.speechVoices.vale, ["vale", "keeper"]);
      const request = { ...seats, op: "speech", world, room: "station", lines };
      if (sorted) {
        request.present = [];
        delete request.room;
      }
      const label = JSON.stringify({ seed, sorted });
      const actual = wasm(request);
      assert.ok(isDeepStrictEqual(actual, run(pinned, request)), label);
      assert.equal(actual.world.revision, world.revision + 1);
      assert.equal(actual.lines[0].seq, world.eventSeq + 1);
      assert.equal(actual.lines[0].text, "The timetable is still here.");
      assert.equal(actual.lines[1].actorId, "keeper");
      assert.equal(actual.lines[1].speaker, "The keeper");
      assert.deepEqual(
        actual.world.actors.keeper.sleeping,
        world.actors.keeper.sleeping,
      );
      const cast = sorted ? ["keeper", "vale"] : ["vale", "keeper"];
      assert.ok(
        actual.lines.every(
          (entry) => !entry.light && isDeepStrictEqual(entry.cast, cast),
        ),
      );
      const repeat = { ...request, world: actual.world, lines: [lines[1]] };
      const repeated = wasm(repeat);
      assert.ok(
        isDeepStrictEqual(repeated, run(pinned, repeat)),
        `repeat ${label}`,
      );
      const view = {
        ...seats,
        op: "view",
        present: request.present,
        world: repeated.world,
      };
      const projected = wasm(view);
      assert.ok(
        isDeepStrictEqual(projected, run(pinned, view)),
        `view ${label}`,
      );
      assert.equal(projected.world.memories.keeper.subjects, undefined);
      assert.deepEqual(
        projected.world.memories.vale,
        repeated.world.memories.vale,
      );
      saved = request;
    }
  }
  for (const changes of [
    { lines: [{ actorId: "moth", text: "Wait for me." }] },
    { lines: [lines[1], lines[1]] },
    { room: "pond", lines: [lines[1]] },
  ]) {
    const request = { ...saved, ...changes };
    assert.equal(pinned(request).ok, false);
    assert.equal(wasm(request), null);
  }
  const unwitnessed = structuredClone(saved.world);
  unwitnessed.log.find(
    (entry) => entry.seq === unwitnessed.arrival.seq,
  ).witnesses = ["vale", "lamp"];
  assert.equal(wasm({ ...saved, world: unwitnessed }), null);
  assert.equal(wasm({ ...seats, op: "view", world: unwitnessed }), null);

  for (const seed of [1, 17]) {
    const world = arrive(pinned, seed, true, false);
    assert.equal(wasm({ ...saved, world }), null);
  }
});
