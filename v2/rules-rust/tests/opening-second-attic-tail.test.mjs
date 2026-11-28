import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const station = "    settleStationExits(next);";
const wayfinder = "    settleStrandedWayfinder(next);";

function traceTail(source) {
  for (const [name, prior, call, later] of [
    ["earlyStation", "    lapseOffer(next, actor);\n", station, ""],
    ["wayfinder", "", wayfinder, "\n    settleHeldItems(next, handSnapshot(s));"],
    ["lateStation", "    settleLamp(next);\n", station, "\n    settleQuests(next);"],
  ]) {
    const marker = `${prior}${call}${later}`;
    assert.equal(source.split(marker).length, 2, name);
    source = source.replace(marker, `${prior}    globalThis.tail.${name} = {before: structuredClone(next)};
${call}
    globalThis.tail.${name}.after = structuredClone(next);
    globalThis.stationOrder = (world) => { settleStationExits(world); return world.stationExitOrder; };${later}`);
  }
  return source;
}

test("second attic station and Wayfinder fallback match every pinned tail boundary", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(traceTail);
  const play = (request) => JSON.parse(reference.cardShared(JSON.stringify(request)));
  let tail;
  for (const seed of [undefined, 0, 17, 4242, 4_294_967_295]) {
    for (const keys of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const { world } = play({ op: "create", seed });
      reference.tail = {};
      const first = play({ ...seats, op: "play", world, action: keys[0] });
      assert.equal(first.ok, true, first.error);
      reference.tail = {};
      const second = play({ ...seats, op: "play", world: first.world, action: keys[1] });
      assert.equal(second.ok, true, second.error);
      tail = JSON.parse(JSON.stringify(reference.tail));
      assert.equal(tail.earlyStation.before.turn, 1);
      assert.equal(tail.lateStation.before.turn, 2);
      for (const [name, { before, after }] of Object.entries(tail)) {
        const phase = name === "wayfinder" ? "wayfinder" : "station";
        assert.deepEqual(wasm({ op: "opening_second_attic_tail", phase, world: before }), { ok: true, world: after });
      }
    }
  }
  const stationDoor = tail.lateStation.before;
  stationDoor.items.routes.holder = "station";
  stationDoor.doors.train = "station";
  assert.ok(reference.stationOrder(structuredClone(stationDoor)).includes("train"));
  assert.equal(wasm({ op: "opening_second_attic_tail", phase: "station", world: stationDoor }), null);
  const stranded = tail.wayfinder.before;
  stranded.items["elysium-wayfinder"].holder = "elysium-void-001";
  assert.equal(wasm({ op: "opening_second_attic_tail", phase: "wayfinder", world: stranded }), null);
});
