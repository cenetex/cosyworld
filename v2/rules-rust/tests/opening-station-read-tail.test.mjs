import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_second_attic_tail";
const early = "station_read_before_wants";
const late = "station_read_after_wants";

function traceTail(source) {
  for (const [name, marker, after] of [
    ["beforeBard", "    for (const id of roamingActors) {", false],
    ["beforeWants", "    settleItemCycle(next, nameOf2, worldLine);", true],
    [
      "afterWants",
      "    pruneTalkQuests(next, wantAPI(next));\n    fillWants(next, wantAPI(next));",
      true,
    ],
    [
      "settled",
      "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));",
      true,
    ],
  ]) {
    assert.equal(source.split(marker).length, 2, name);
    const capture = `    globalThis.${name} = structuredClone(next);`;
    source = source.replace(
      marker,
      after ? `${marker}\n${capture}` : `${capture}\n${marker}`,
    );
  }
  return source;
}

test("the first Station log read preserves the pinned quiet phases around wants", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceTail);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const [seed, dry, spoken, sorted, useObject] of [
    [undefined, false, false, false, false],
    [0, true, false, true, true],
    [2, false, true, false, true],
    [42, true, true, true, false],
    [4242, false, false, true, false],
    [4_294_967_295, true, false, false, false],
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
    for (const action of [
      "move:vale::pond",
      dry ? "move:vale:lamp:station" : "move:vale::station",
    ])
      world = run({ ...seats, op: "play", world, action });
    if (spoken)
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "Wait beside the timetable." }],
      });
    if (sorted)
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    const key = "read:vale:keeper-log:";
    const request = {
      ...seats,
      op: "play",
      world,
      action: useObject ? { key } : key,
      revision: world.revision,
    };
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    assert.deepEqual(
      reply.events.map((event) => event.verb),
      ["read", "wait"],
    );
    const capture = (key) => JSON.parse(JSON.stringify(reference[key]));
    for (const [phase, from, to] of [
      [early, "beforeBard", "beforeWants"],
      [late, "afterWants", "settled"],
    ]) {
      const before = capture(from);
      const expected = capture(to);
      assert.ok(
        isDeepStrictEqual(before, expected),
        `${seed}: ${phase} oracle`,
      );
      const actual = wasm({ op, phase, before: world, world: before });
      assert.ok(
        isDeepStrictEqual(actual, { ok: true, world: expected }),
        `${seed}: ${phase}`,
      );
    }
    sample = { before: world, world: capture("beforeBard") };
  }
  for (const change of [
    (world) => {
      world.actors["greek-rhapsode"].dwellUntil = 3;
    },
    (world) => {
      world.actors.vale.sleeping = { place: "station", since: 2, present: [] };
    },
    (world) => {
      world.log.at(-1).guards = true;
    },
  ]) {
    const world = structuredClone(sample.world);
    change(world);
    assert.equal(
      wasm({ op, phase: early, before: sample.before, world }),
      null,
    );
  }
  const stale = { ...sample.before, eventSeq: sample.before.eventSeq - 1 };
  assert.equal(
    wasm({ op, phase: late, before: stale, world: sample.world }),
    null,
  );
});
