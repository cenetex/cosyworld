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

const wake = "    wakeSleepers(next, s, voyages);";
const rumours = "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";

function traceQuiet(source) {
  for (const [name, start, end] of [
    ["stops", "    settleStops(next, {", "    if (unmetAt(next, next.actors[currentActor(next)]?.place)) meetCast(next);"],
    ["wake", wake, wake],
    ["arcana", "    settleArcana(\n      next,", "    settleCompany(next, entityActive);"],
    ["facts", "    settleQuests(next);\n    noteRumours", rumours],
  ]) {
    assert.equal(source.split(start).length, 2, name);
    assert.equal(source.split(end).length, 2, name);
    source = source.replace(start, `    globalThis.quiet.${name} = structuredClone(next);\n${start}`);
    source = source.replace(end, `${end}\n    globalThis.quiet.${name}After = structuredClone(next);`);
  }
  return source;
}

test("the quiet second attic tail matches the pinned stop, wake, arcana and fact phases", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(traceQuiet);
  const play = (request) => JSON.parse(reference.cardShared(JSON.stringify(request)));
  let before;
  let traced;
  for (const seed of [undefined, 0, 17, 4242, 4_294_967_295]) {
    for (const keys of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      let { world } = play({ op: "create", seed });
      if (seed === 17) {
        ({ world } = play({
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        }));
      }
      reference.quiet = {};
      const first = play({ ...seats, op: "play", world, action: keys[0] });
      assert.equal(first.ok, true, first.error);
      before = first.world;
      reference.quiet = {};
      const second = play({ ...seats, op: "play", world: before, action: keys[1] });
      assert.equal(second.ok, true, second.error);
      traced = JSON.parse(JSON.stringify(reference.quiet));
      assert.equal(traced.arcana.actors["greek-guard"].guarding, "greek-battlefield");
      for (const [name, phase] of [["stops", "stops"], ["wake", "wake"], ["arcana", "quiet"], ["facts", "quiet"]]) {
        const request = { op: "opening_second_attic_tail", phase, before, world: traced[name] };
        assert.deepEqual(wasm(request), { ok: true, world: traced[`${name}After`] });
      }
    }
  }
  for (const [phase, scene, change] of [
    ["stops", "stops", (world) => { world.actors.vale.arcana = { calls: 3 }; }],
    ["wake", "wake", (world) => { world.actors.vale.sleeping = { since: 1, place: "attic", present: [] }; }],
    ["quiet", "arcana", (world) => { delete world.actors["greek-guard"].guarding; }],
    ["quiet", "arcana", (world) => { world.items["willows-notebook"].holder = "pond"; }],
    ["quiet", "facts", (world) => { world.actors.vale.want = { from: "quest:box:pond" }; }],
    ["quiet", "facts", (world) => { world.items.oil.holder = "moth"; }],
    ["quiet", "facts", (world) => {
      world.log.push({ seq: ++world.eventSeq, verb: "want_met", wantMet: { kind: "place", target: "station" } });
    }],
  ]) {
    const world = structuredClone(traced[scene]);
    change(world);
    assert.equal(wasm({ op: "opening_second_attic_tail", phase, before, world }), null);
  }
  const nested = structuredClone(traced.facts);
  before.items.cloth.holder = nested.items.cloth.holder = "oil";
  nested.items.oil.holder = "pond";
  const packed = { op: "opening_second_attic_tail", phase: "quiet", before, world: nested };
  assert.deepEqual(wasm(packed), { ok: true, world: nested });
  nested.items.oil.holder = "moth";
  assert.equal(wasm(packed), null);
});
