import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wake = { op: "opening_station_residents", resident: "keeper" };

function traceKeeper(source) {
  const condition =
    'id === "keeper" && s.began === 480 && s.actors.vale.place === "station" && s.turn === 482';
  for (const [frame, marker] of [
    ["beforeKeeper", "      const a = s.actors[id], z = a.sleeping;"],
    [
      "afterKeeper",
      "        continue;\n      }\n      const w = bedtime(s, id);",
    ],
  ]) {
    assert.equal(source.split(marker).length, 2, frame);
    source = source.replace(
      marker,
      `      if (${condition}) globalThis.${frame} = structuredClone(s);\n${marker}`,
    );
  }
  return source;
}

test("Keeper's scheduled wake matches the historic Station narration and memories", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceKeeper);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const seed of [17, 99]) {
    const fresh = run({ op: "create", history: true, seed });
    const reopened = run({ op: "create", save: JSON.stringify(fresh) });
    const stowed = run({
      ...seats,
      op: "hold",
      world: reopened,
      choice: { item: null, revision: reopened.revision },
    });
    const pond = run({
      ...seats,
      op: "play",
      world: stowed,
      action: "move:vale::pond",
    });
    const sorted = Object.fromEntries(Object.entries(pond.actors).toSorted());
    for (const actors of [pond.actors, sorted]) {
      for (const key of ["move:vale::station", "move:vale:lamp:station"]) {
        reference.beforeKeeper = reference.afterKeeper = undefined;
        const reply = JSON.parse(
          reference.cardShared(
            JSON.stringify({
              ...seats,
              op: "play",
              world: { ...pond, actors },
              action: actors === sorted ? { key } : key,
            }),
          ),
        );
        assert.equal(reply.ok, true, reply.error);
        const before = JSON.parse(JSON.stringify(reference.beforeKeeper));
        const after = JSON.parse(JSON.stringify(reference.afterKeeper));
        const label = `${seed} ${key} ${actors === sorted ? "sorted" : "authored"}`;
        assert.deepEqual(before.actors.keeper.sleeping, {
          since: 481,
          place: "station",
          until: 482,
        });
        assert.equal(before.log.at(-1).actorId, seed === 17 ? "orin" : "moth");
        assert.equal(after.actors.keeper.sleeping, undefined);
        assert.equal(after.actors.keeper.slept, before.actors.keeper.slept);
        const event = after.log.at(-1);
        assert.equal(event.seq, before.eventSeq + 1);
        assert.equal(event.actorId, "keeper");
        assert.equal(event.text, "The keeper wakes.");
        assert.deepEqual(
          event.cast,
          actors === sorted
            ? ["keeper", "moth", "vale"]
            : ["vale", "moth", "keeper"],
        );
        for (const id of ["vale", "moth", "keeper", "keeper-log"])
          assert.notDeepEqual(before.memories[id], after.memories[id]);
        const actual = wasm({ ...wake, world: before });
        assert.ok(actual?.ok, `unsupported ${label}`);
        const field = Object.keys(after).find(
          (name) => !isDeepStrictEqual(actual.world[name], after[name]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label} ${field ?? "envelope"}`,
        );
        assert.equal(wasm({ ...wake, world: after }), null);
        sample = before;
      }
    }
  }
  for (const mutate of [
    (world) => {
      world.actors.keeper.sleeping.until = 483;
    },
    (world) => {
      world.log = world.log.filter(
        (event) => event.seq !== world.arrival.seq + 1,
      );
    },
    (world) => {
      world.actors.mara.place = "station";
    },
  ]) {
    const world = structuredClone(sample);
    mutate(world);
    assert.equal(wasm({ ...wake, world }), null);
  }
});

function traceAwakeSleep(source) {
  source = traceKeeper(source);
  const frames = [
    ["beforeLife", "    for (const id of life) {", "s", false],
    [
      "afterSleep",
      "    const dawnOrDusk = s.turn % DAYLIGHT_TURNS === 0;",
      "s",
      false,
    ],
    ["beforeWake", "    wakeSleepers(next, s, voyages);", "next", false],
    ["afterWake", "    wakeSleepers(next, s, voyages);", "next", true],
  ];
  for (const [field, marker, world, after] of frames) {
    assert.equal(source.split(marker).length, 2, field);
    const remember = `    if (${world}.turn === 482) globalThis.${field} = structuredClone(${world});`;
    source = source.replace(
      marker,
      after ? `${marker}\n${remember}` : `${remember}\n${marker}`,
    );
  }
  return source;
}

test("historic Station settles the awake Pip round and Keeper wake in resident order", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceAwakeSleep);
  const copy = (world) => JSON.parse(JSON.stringify(world));
  const op = "opening_station_resident_sleep";
  const late = "opening_station_wake";
  function run(request) {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  }
  function observe(world, action) {
    const reply = JSON.parse(
      reference.cardShared(
        JSON.stringify({ ...seats, op: "play", world, action }),
      ),
    );
    assert.equal(reply.ok, true, reply.error);
    return reply;
  }
  function arriveAtPond(seed, mode) {
    const fresh = run({ op: "create", history: true, seed });
    let world = run({ op: "create", save: JSON.stringify(fresh) });
    if (mode === "dry") {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
    }
    return run({ ...seats, op: "play", world, action: "move:vale::pond" });
  }

  let staged;
  for (const [seed, mode] of [
    [99, "stowed"],
    [99, "dry"],
    [17, "stowed"],
    [17, "dry"],
  ]) {
    const cass = seed === 17;
    const pond = arriveAtPond(seed, mode);
    const sorted = Object.fromEntries(Object.entries(pond.actors).toSorted());
    for (const actors of [pond.actors, sorted]) {
      const key =
        mode === "dry" ? "move:vale:lamp:station" : "move:vale::station";
      const reply = observe(
        { ...pond, actors },
        actors === sorted ? { key } : key,
      );
      assert.deepEqual(
        reply.events.map(({ actorId }) => actorId),
        cass ? ["vale", "moth", "orin", "keeper"] : ["vale", "moth", "keeper"],
      );
      const before = copy(reference.beforeLife);
      const middle = copy(reference.afterKeeper);
      const after = copy(reference.afterSleep);
      const label = `${seed} ${mode} ${actors === sorted ? "sorted" : "authored"}`;
      assert.equal(before.eventSeq, before.arrival.seq + (cass ? 2 : 1), label);
      assert.equal(middle.eventSeq, before.eventSeq + 1, label);
      assert.equal(after.actors.moth.homeward, cass ? true : undefined, label);
      assert.equal(after.actors.moth.place, "station", label);
      assert.equal(after.actors.moth.sleeping, undefined, label);
      const woke = Object.keys(before.actors)
        .filter(
          (id) => before.actors[id].sleeping && !after.actors[id].sleeping,
        )
        .sort();
      assert.deepEqual(
        woke,
        cass
          ? [
              "elysium-chatgpt",
              "greek-market-neighbor",
              "greek-story-aeschylus-persians-first",
              "greek-story-aeschylus-prometheus-bound-first",
              "greek-story-euripides-orestes-first",
              "greek-story-sophocles-oedipus-tyrannus-first",
              "keeper",
              "oak",
            ]
          : [
              "greek-baker",
              "greek-creon",
              "greek-marathon-keeper",
              "greek-story-aristophanes-thesmophoria-first",
              "keeper",
              "rue",
            ],
      );
      staged = {
        ...copy(before),
        log: middle.log,
        memories: middle.memories,
        eventSeq: middle.eventSeq,
      };
      staged.actors.keeper = middle.actors.keeper;
      for (const frame of [before, staged, middle]) {
        const actual = wasm({ op, world: frame });
        assert.ok(actual, `unsupported ${label}`);
        const field = Object.keys(after).find(
          (name) => !isDeepStrictEqual(actual.world[name], after[name]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label} ${field ?? "envelope"}`,
        );
      }
      const beforeWake = copy(reference.beforeWake);
      const afterWake = copy(reference.afterWake);
      assert.ok(isDeepStrictEqual(beforeWake, afterWake), label);
      assert.deepEqual(
        wasm({ op: late, world: beforeWake }),
        { ok: true, world: afterWake },
        label,
      );
    }
  }

  for (const mutate of [
    (world) => {
      world.log.at(-1).text = "The keeper waits.";
    },
    (world) => {
      world.actors.keeper.sleeping = {
        since: 481,
        place: "station",
        until: 482,
      };
    },
    (world) => {
      world.actors.mara.place = "station";
    },
    (world) => {
      world.items.board.holder = "orin";
    },
    (world) => {
      world.routeKnowledge.moth = [];
    },
  ]) {
    const world = structuredClone(staged);
    mutate(world);
    assert.equal(wasm({ op, world }), null);
  }
});
