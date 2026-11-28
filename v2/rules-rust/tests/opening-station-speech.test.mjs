import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const lines = [
  { actorId: "vale", text: "  The platform feels colder. " },
  { entityId: "station", text: "The timetable rattles." },
  { entityId: "keeper", text: "Mind the edge of the platform." },
];

function run(pinned, request) {
  const reply = pinned(request);
  assert.equal(reply.ok, true, reply.error);
  return reply;
}

function arrived(pinned, seed, dry, previousSpeech) {
  let { world } = run(pinned, { op: "create", seed });
  if (dry)
    Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
  else {
    ({ world } = run(pinned, {
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    }));
  }
  ({ world } = run(pinned, {
    ...seats,
    op: "play",
    world,
    action: "move:vale::pond",
  }));
  if (previousSpeech) {
    ({ world } = run(pinned, {
      ...seats,
      op: "speech",
      world,
      room: "pond",
      lines: [{ entityId: "pond", text: "A ripple breaks the surface." }],
    }));
  }
  return run(pinned, {
    ...seats,
    op: "play",
    world,
    action: dry ? "move:vale:lamp:station" : "move:vale::station",
  });
}

test("Vale, the keeper and the Station publish complete pinned speech replies", async () => {
  const { pinned, wasm } = await reducers();
  for (const [seed, dry, prior, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
    [42, true, true, true],
    [4242, false, false, true],
    [4_294_967_295, true, false, false],
  ]) {
    const arrivedAtStation = arrived(pinned, seed, dry, prior);
    const world = arrivedAtStation.world;
    const request = { ...seats, op: "speech", room: "station", world, lines };
    if (sorted) {
      request.present = [];
      delete request.room;
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    }
    const actual = wasm(request);
    const label = JSON.stringify({ seed, dry, prior, sorted });
    assert.ok(isDeepStrictEqual(actual, run(pinned, request)), label);
    assert.deepEqual(actual.world.speechVoices.vale, ["vale", "keeper"]);
    assert.equal(actual.world.revision, world.revision + 1);
    assert.equal(actual.lines[0].seq, world.eventSeq + 1);
    assert.equal(actual.lines[0].text, "The platform feels colder.");
    const cast = sorted
      ? ["keeper", "moth", "vale"]
      : ["vale", "moth", "keeper"];
    for (const line of actual.lines) {
      assert.deepEqual(line.cast, cast);
      assert.equal(line.light, false);
    }

    const repeat = { ...request, world: actual.world, lines: [lines[2]] };
    const repeated = wasm(repeat);
    assert.ok(
      isDeepStrictEqual(repeated, run(pinned, repeat)),
      `repeat ${label}`,
    );
    const view = { ...seats, op: "view", world: repeated.world };
    assert.ok(
      isDeepStrictEqual(wasm(view), run(pinned, view)),
      `view ${label}`,
    );
  }
});

test("Station speech rejects an uncalled speaker, a duplicate and a different room", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = arrived(pinned, 2, false, false);
  const speech = { ...seats, op: "speech", room: "station", world, lines };
  for (const request of [
    { ...speech, lines: [{ actorId: "moth", text: "Is it time?" }] },
    { ...speech, lines: [lines[0], lines[0]] },
    { ...speech, room: "pond", lines: [lines[2]] },
  ]) {
    assert.equal(pinned(request).ok, false);
    assert.equal(wasm(request), null);
  }
});
