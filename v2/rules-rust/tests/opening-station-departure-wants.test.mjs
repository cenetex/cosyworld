import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_departure_wants";
const life = "opening_station_departure_life";

function traceRound(source) {
  for (const [name, marker, after] of [
    [
      "beforeLife",
      "    residentRound(next, [...cast, ...lightPlays(next, round2, cast)]);",
    ],
    ["afterLife", "    settleStops(next, {"],
    ["afterStops", "    const worldLine = (text2, locationId) =>"],
    ["beforeWake", "    wakeSleepers(next, s, voyages);"],
    ["afterWake", "    settleItemCycle(next, nameOf2, worldLine);"],
    ["beforeWants", "    reviseStalledWants(\n      next,"],
    ["afterWants", "    fillWants(next, wantAPI(next));", true],
    [
      "afterTail",
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

test("fresh Station departures match quiet life, wake, and wants cuts", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceRound);
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
  const check = (request, expected, label) => {
    const actual = wasm(request);
    const differingField = Object.keys(expected).find(
      (key) => !isDeepStrictEqual(actual?.world[key], expected[key]),
    );
    assert.ok(
      isDeepStrictEqual(actual, { ok: true, world: expected }),
      `${label}: ${request.op} ${actual ? differingField : "unsupported"}`,
    );
    return actual.world;
  };
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
        const label = `${seed} ${to} dry=${dry}`;
        const day = { op: life, before, world: capture("beforeLife") };
        assert.ok(isDeepStrictEqual(day.world, capture("afterLife")), label);
        check(day, capture("afterStops"), label);
        check(
          { op: life, before, world: capture("beforeWake") },
          capture("afterWake"),
          label,
        );
        const request = { op, before, world: capture("beforeWants") };
        const settled = check(request, capture("afterWants"), label);
        assert.deepEqual(settled.actors.vale.want, before.actors.vale.want);
        assert.equal(settled.actors.moth.want.refusals, 1);
        assert.equal(settled.actors["greek-aethra"].want.since, settled.turn);
        check(
          {
            op: "opening_second_attic_tail",
            phase: "station_departure_after_wants",
            before,
            world: settled,
          },
          capture("afterTail"),
          label,
        );
        if (to === "pond") sample = { request, day };
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
    const request = structuredClone(sample.request);
    change(request);
    assert.equal(wasm(request), null);
  }
  for (const change of [
    (world) => {
      world.turn = 24;
    },
    (world) => {
      world.actors.keeper.sleeping = { place: "station", since: 3, until: 4 };
    },
    (world) => {
      world.actors.vale.arcana = { calls: 3 };
    },
    (world) => {
      world.actors["greek-rhapsode"].place = "pond";
    },
  ]) {
    const request = structuredClone(sample.day);
    change(request.world);
    assert.equal(wasm(request), null);
  }
});

test("bringing Pip's cloth to the Pond settles the turn-six wants and visit speech", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceRound);
  const run = (request) => {
    const result = pinned(request);
    assert.equal(result.ok, true, result.error);
    return result.world;
  };
  const capture = (name) => JSON.parse(JSON.stringify(reference[name]));
  let sample;
  for (const [seed, dry, spoken] of [
    [undefined, false, false],
    [0, true, false],
    [2, false, true],
    [17, false, false],
    [42, true, true],
    [4242, false, false],
    [4_294_967_295, true, false],
  ]) {
    let before = run({ op: "create", seed });
    if (dry)
      Object.assign(before.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    else
      before = run({
        ...seats,
        op: "hold",
        world: before,
        choice: { item: null, revision: before.revision },
      });
    for (const action of [
      "move:vale::pond",
      "move:vale::station",
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
    ])
      before = run({ ...seats, op: "play", world: before, action });
    if (spoken)
      before = run({
        ...seats,
        op: "speech",
        world: before,
        room: "station",
        lines: [{ actorId: "vale", text: "Time to return to the pond." }],
      });
    for (const action of ["move:vale::pond", "move:vale:lamp:pond"]) {
      const completed = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: before,
            action,
          }),
        ),
      );
      assert.equal(completed.ok, true, completed.error);
      const initial = capture("beforeWants");
      const request = { op, before, world: initial };
      const wanted = wasm(request);
      const after = capture("afterWants");
      const label = `${seed} ${action}`;
      assert.ok(
        isDeepStrictEqual(wanted, { ok: true, world: after }),
        `${label} wants`,
      );
      assert.deepEqual(after.actors.vale.want, before.actors.vale.want);
      assert.equal(after.actors["greek-aethra"].want.since, 6);
      const tail = wasm({
        op: "opening_second_attic_tail",
        phase: "station_departure_after_wants",
        before,
        world: after,
      });
      const expected = capture("afterTail");
      assert.ok(
        isDeepStrictEqual(tail, { ok: true, world: expected }),
        `${label} tail`,
      );
      assert.deepEqual(expected.actors.vale.waitSpeech, {
        place: "pond",
        turn: null,
      });
      assert.deepEqual(expected.life, initial.life);
      assert.deepEqual(expected.log, initial.log);
      sample = request;
    }
  }
  for (const corrupt of [
    ({ before }) => {
      delete before.life.actors.vale.attachments.cloth;
    },
    ({ before, world }) => {
      for (const frame of [before, world])
        frame.log.findLast(({ verb }) => verb === "give").accepted = false;
    },
    ({ world }) => {
      world.items.lamp.fuel++;
    },
    ({ world }) => {
      world.items.oil.holder = "vale";
    },
  ]) {
    const request = structuredClone(sample);
    corrupt(request);
    assert.equal(wasm(request), null);
  }
});
