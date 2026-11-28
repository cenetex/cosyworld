import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
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

test("the second pond arrival keeps the pinned working-world tail stable", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine((source) =>
    traceQuiet(traceTail(source)),
  );
  const save = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const op = "opening_second_attic_tail";
  let before;
  let stopped;
  for (const seed of [undefined, 0, 2, 17, 42, 4242, 4_294_967_295]) {
    for (const mode of ["stowed", "dry"]) {
      let world = save({ op: "create", seed });
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      reference.tail = {};
      reference.quiet = {};
      world = save({ ...seats, op: "play", world, action: "wait:vale::" });
      if (mode === "stowed") {
        world = save({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
      }
      const spoken = save({
        ...seats,
        op: "speech",
        world,
        room: "attic",
        lines: [{ entityId: "attic", text: "The old shutters rattle." }],
      });
      for (const [key, prior] of [
        ["move:vale::pond", world],
        ["move:vale:lamp:pond", spoken],
      ]) {
        before = prior;
        const sorted = seed === 2 || seed === 4242;
        if (sorted)
          before.actors = Object.fromEntries(
            Object.entries(before.actors).toSorted(),
          );
        reference.tail = {};
        reference.quiet = {};
        const settled = save({
          ...seats,
          op: "play",
          world: before,
          action: sorted ? { key } : key,
        });
        assert.equal(settled.actors.vale.place, "pond");
        const tail = JSON.parse(JSON.stringify(reference.tail));
        const quiet = JSON.parse(JSON.stringify(reference.quiet));
        stopped = quiet.stops;
        assert.equal(stopped.opening.met.moth, 2);
        for (const [phase, from, expected] of [
          ["station", tail.earlyStation.before, tail.earlyStation.after],
          ["stops", quiet.stops, quiet.stopsAfter],
          ["wake", quiet.wake, quiet.wakeAfter],
          ["quiet", quiet.arcana, quiet.arcanaAfter],
          ["wayfinder", tail.wayfinder.before, tail.wayfinder.after],
          ["station", tail.lateStation.before, tail.lateStation.after],
          ["quiet", quiet.facts, quiet.factsAfter],
        ]) {
          const label = `${seed} ${mode} ${key} ${phase} turn ${from.turn}`;
          assert.ok(
            isDeepStrictEqual(from, expected),
            `pinned changed ${label}`,
          );
          const actual = wasm({ op, phase, before, world: from });
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: expected }),
            label,
          );
        }
      }
    }
  }
  for (const [phase, change] of [
    [
      "stops",
      (world) => {
        delete world.opening.met.moth;
      },
    ],
    [
      "stops",
      (world) => {
        world.actors.mara.place = "pond";
      },
    ],
    [
      "stops",
      (world) => {
        world.actors.moth.place = "station";
      },
    ],
    [
      "wake",
      (world) => {
        world.actors.vale.sleeping = { since: 1, place: "pond", present: [] };
      },
    ],
    [
      "wayfinder",
      (world) => {
        world.items["elysium-wayfinder"].holder = "elysium-void-001";
      },
    ],
  ]) {
    const world = structuredClone(stopped);
    change(world);
    assert.equal(wasm({ op, phase, before, world }), null);
  }
  const unrelated = structuredClone(before);
  unrelated.eventSeq -= 1;
  assert.equal(
    wasm({ op, phase: "quiet", before: unrelated, world: stopped }),
    null,
  );
});

test("both Station arrival horizons match the pinned settling boundaries", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine((source) =>
    traceQuiet(traceTail(source)),
  );
  const save = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const op = "opening_second_attic_tail";
  let before;
  let tail;
  let quiet;
  for (const seed of [undefined, 0, 2, 17, 42, 4242, 4_294_967_295]) {
    for (const waited of [false, true]) {
      for (const lamp of ["stowed", "dry"]) {
        let world = save({ op: "create", seed });
        if (lamp === "stowed") {
          world = save({
            ...seats,
            op: "hold",
            world,
            choice: { item: null, revision: world.revision },
          });
        } else {
          Object.assign(world.items.lamp, {
            fuel: 0,
            fuelRooms: 0,
            lit: false,
          });
        }
        if (waited)
          world = save({ ...seats, op: "play", world, action: "wait:vale::" });
        before = save({
          ...seats,
          op: "play",
          world,
          action: "move:vale::pond",
        });
        if (lamp === "dry") {
          before = save({
            ...seats,
            op: "speech",
            world: before,
            room: "pond",
            lines: [{ entityId: "pond", text: "Water laps the shore." }],
          });
        }
        if (seed === 2 || seed === 4242) {
          before.actors = Object.fromEntries(
            Object.entries(before.actors).toSorted(),
          );
        }
        const action =
          (lamp === "dry") !== waited
            ? "move:vale:lamp:station"
            : "move:vale::station";
        reference.tail = {};
        reference.quiet = {};
        const played = JSON.parse(
          reference.cardShared(
            JSON.stringify({ ...seats, op: "play", world: before, action }),
          ),
        );
        assert.equal(played.ok, true, played.error);
        tail = JSON.parse(JSON.stringify(reference.tail));
        quiet = JSON.parse(JSON.stringify(reference.quiet));
        assert.equal(quiet.stops.turn, waited ? 3 : 2);
        assert.equal(quiet.stops.opening.met.moth, quiet.stops.turn - 1);
        assert.equal(quiet.stops.opening.met.keeper, quiet.stops.turn);
        for (const [phase, input, expected] of [
          ["station_order", tail.earlyStation.before, tail.earlyStation.after],
          ["stops", quiet.stops, quiet.stopsAfter],
          ["wake", quiet.wake, quiet.wakeAfter],
          ["quiet", quiet.arcana, quiet.arcanaAfter],
          ["wayfinder", tail.wayfinder.before, tail.wayfinder.after],
          ["station_hands_lamp", tail.wayfinder.after, tail.lateStation.before],
          ["station", tail.lateStation.before, tail.lateStation.after],
          ["quiet", quiet.facts, quiet.factsAfter],
        ]) {
          const label = `${seed} ${waited} ${lamp} turn ${input.turn} ${phase}`;
          assert.ok(
            isDeepStrictEqual(input, expected),
            `pinned changed ${label}`,
          );
          const actual = wasm({ op, phase, before, world: input });
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: expected }),
            label,
          );
        }
      }
    }
  }
  for (const [phase, saved, change] of [
    [
      "stops",
      quiet.stops,
      (world) => {
        delete world.opening.met.keeper;
      },
    ],
    [
      "stops",
      quiet.stops,
      (world) => {
        world.actors.mara.place = "station";
      },
    ],
    [
      "wake",
      quiet.wake,
      (world) => {
        world.actors.vale.sleeping = {
          since: 2,
          place: "station",
          present: [],
        };
      },
    ],
    [
      "wayfinder",
      tail.wayfinder.before,
      (world) => {
        world.items["elysium-wayfinder"].holder = "elysium-void-001";
      },
    ],
    [
      "station_hands_lamp",
      tail.wayfinder.after,
      (world) => {
        world.items.oil.holder = "vale";
      },
    ],
    [
      "quiet",
      quiet.facts,
      (world) => {
        world.actors.vale.want = { from: "quest:box:pond" };
      },
    ],
  ]) {
    const world = structuredClone(saved);
    change(world);
    assert.equal(wasm({ op, phase, before, world }), null);
  }
  const wrongSource = { ...before, eventSeq: before.eventSeq - 1 };
  assert.equal(
    wasm({ op, phase: "quiet", before: wrongSource, world: quiet.facts }),
    null,
  );
});
