import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const bard = "greek-rhapsode";
const life = "    residentRound(next, [...cast, ...lightPlays(next, round2, cast)]);";

function traceStationLife(source) {
  const roaming = "    for (const id of roamingActors) {";
  assert.equal(source.split(roaming).length, 2);
  assert.equal(source.split(life).length, 2);
  return source
    .replace(roaming, `    globalThis.beforeBard = structuredClone(next);\n${roaming}`)
    .replace(life, `    globalThis.beforeLife = structuredClone(next);\n${life}
    globalThis.afterLife = structuredClone(next);`);
}

test("both Station arrival horizons match pinned Bard dwell and offstage life", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceStationLife);
  const movers = new Set();
  let state;
  for (const seed of [undefined, 2, 17, 4242, 4_294_967_295]) {
    let { world } = pinned({ op: "create", seed });
    if (seed === 17) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      ({ world } = pinned({
        ...seats, op: "hold", world,
        choice: { item: null, revision: world.revision },
      }));
    }
    for (const waited of [false, true]) {
      const start = waited ? pinned({ ...seats, op: "play", world, action: "wait:vale::" }).world : world;
      const pond = pinned({ ...seats, op: "play", world: start, action: "move:vale::pond" });
      assert.equal(pond.ok, true, pond.error);
      const roads = pond.world.routeKnowledge[bard];
      const forgotten = seed === 17;
      if (forgotten) {
        const road = roads.findIndex(([from]) => from === pond.world.actors[bard].place);
        assert.ok(road >= 0);
        roads.splice(road, 1);
      }
      for (const key of ["move:vale::station", "move:vale:lamp:station"]) {
        const request = { ...seats, op: "play", world: pond.world, action: waited ? { key } : key };
        const played = JSON.parse(reference.cardShared(JSON.stringify(request)));
        assert.equal(played.ok, true, played.error);
        for (const event of played.events) {
          if (event.verb === "move" && !["vale", "moth"].includes(event.actorId)) movers.add(event.actorId);
        }
        const { beforeBard, beforeLife, afterLife } = JSON.parse(JSON.stringify({
          beforeBard: reference.beforeBard,
          beforeLife: reference.beforeLife,
          afterLife: reference.afterLife,
        }));
        const label = JSON.stringify({ seed, waited, key });
        assert.equal(beforeLife.turn, waited ? 3 : 2, label);
        assert.equal(beforeLife.eventSeq, beforeBard.eventSeq, label);
        assert.equal(beforeLife.routeKnowledge[bard].length, roads.length + Number(forgotten), label);
        assert.deepEqual(wasm({ op: "opening_bard_dwell", world: beforeBard }), { ok: true, world: beforeLife }, label);
        assert.deepEqual(wasm({ op: "opening_station_life", world: beforeLife }), { ok: true, world: afterLife }, label);
        state = beforeLife;
      }
    }
  }
  assert.deepEqual([...movers], []);
  const badArrival = structuredClone(state);
  badArrival.arrival.fromLocationId = "attic";
  assert.equal(wasm({ op: "opening_bard_dwell", world: badArrival }), null);
  const noFollow = structuredClone(state);
  noFollow.log = noFollow.log.filter((event) => event.seq !== noFollow.arrival.seq + 1);
  assert.equal(wasm({ op: "opening_station_life", world: noFollow }), null);
  state.actors.mara.place = "station";
  assert.equal(wasm({ op: "opening_station_life", world: state }), null);
});

function traceDwellAndWalkers(source) {
  const plan = "      const chosen = plan(next, id);";
  const walkers = "    const dawnOrDusk = s.turn % DAYLIGHT_TURNS === 0;";
  const walked = "    if (!moved2.length) return;";
  for (const boundary of [plan, walkers, walked]) {
    assert.equal(source.split(boundary).length, 2);
  }
  return traceStationLife(source)
    .replace(
      "    globalThis.beforeBard =",
      "    globalThis.setupBard?.(next);\n$&",
    )
    .replace(plan, "$&\n      globalThis.bardPlays.push(chosen.action.key);")
    .replace(
      walkers,
      `    globalThis.setupWalk?.(s);
    globalThis.beforeWalk = structuredClone(s);
    globalThis.acted = structuredClone(acted);
$&`,
    )
    .replace(
      walked,
      `    globalThis.afterWalk = structuredClone(s);
    globalThis.moves = structuredClone(moved2);
$&`,
    );
}

test("historic Station preserves Bard dwell and proves no offstage walks", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceDwellAndWalkers);
  const copy = (state) => JSON.parse(JSON.stringify(state));
  const dwell = "opening_bard_dwell";
  const walkers = "opening_history_walkers";
  let request, scout;
  const observe = (play) => {
    reference.bardPlays = [];
    const played = JSON.parse(reference.cardShared(JSON.stringify(play)));
    assert.equal(played.ok, true, played.error);
  };
  for (const seed of [undefined, 2, 42, 4242]) {
    for (const mode of ["stowed", "dry"]) {
      let { world } = pinned({ op: "create", history: true, seed });
      if (mode === "stowed") {
        const held = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(held.ok, true, held.error);
        world = held.world;
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const pond = pinned({
        ...seats,
        op: "play",
        world,
        action: "move:vale::pond",
      });
      assert.equal(pond.ok, true, pond.error);
      assert.equal(pond.world.actors.moth.sleeping.since, 481);
      const forgotten = seed === 42;
      const roads = pond.world.routeKnowledge[bard];
      if (forgotten) {
        const road = roads.findIndex(
          ([from]) => from === pond.world.actors[bard].place,
        );
        assert.ok(road >= 0);
        roads.splice(road, 1);
      }
      const action =
        mode === "dry" ? "move:vale:lamp:station" : "move:vale::station";
      request = { ...seats, op: "play", world: pond.world, action };
      observe(request);
      const beforeBard = copy(reference.beforeBard);
      const afterBard = copy(reference.beforeLife);
      const label = `${seed} ${mode}`;
      assert.deepEqual(copy(reference.bardPlays), [`wait:${bard}::`], label);
      assert.equal(afterBard.turn, 482, label);
      assert.equal(afterBard.eventSeq, beforeBard.eventSeq, label);
      assert.equal(
        afterBard.routeKnowledge[bard].length,
        roads.length + Number(forgotten),
        label,
      );
      assert.deepEqual(
        wasm({ op: dwell, world: beforeBard }),
        { ok: true, world: afterBard },
        label,
      );
      const beforeWalk = copy(reference.beforeWalk);
      const afterWalk = copy(reference.afterWalk);
      const acted = copy(reference.acted);
      assert.deepEqual(copy(reference.moves), [], label);
      assert.deepEqual(
        wasm({ op: walkers, world: beforeWalk, acted }),
        { ok: true, world: afterWalk },
        label,
      );
      scout = beforeBard;
    }
  }
  const another = copy(scout);
  another.packs.ratiradio.flags["rati-awake"] = true;
  assert.equal(wasm({ op: dwell, world: another }), null);
  const sleeping = copy(scout);
  delete sleeping.actors.moth.sleeping;
  assert.equal(wasm({ op: dwell, world: sleeping }), null);

  reference.setupBard = (state) => {
    state.actors[bard].dwellUntil = state.turn;
  };
  observe(request);
  assert.match(reference.bardPlays[0], /^move:greek-rhapsode::/);
  assert.equal(wasm({ op: dwell, world: copy(reference.beforeBard) }), null);
  delete reference.setupBard;

  reference.setupWalk = (state) => {
    state.actors.whiskerwind.dwellUntil = state.turn;
    state.actors.whiskerwind.homeward = true;
  };
  observe(request);
  assert.deepEqual(copy(reference.moves), ["whiskerwind"]);
  assert.equal(
    wasm({
      op: walkers,
      world: copy(reference.beforeWalk),
      acted: copy(reference.acted),
    }),
    null,
  );
});

test("the Bard dwells on both quiet Station departures", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceDwellAndWalkers);
  const copy = (world) => JSON.parse(JSON.stringify(world));
  const op = "opening_bard_dwell";
  function run(request) {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  }
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  function observe(world, action) {
    reference.bardPlays = [];
    const reply = JSON.parse(
      reference.cardShared(
        JSON.stringify({ ...seats, op: "play", world, action }),
      ),
    );
    assert.equal(reply.ok, true, reply.error);
    return [copy(reference.beforeBard), copy(reference.beforeLife)];
  }

  let sample, station, read, accepted;
  for (const seed of [undefined, 2, 17, 42, 4242]) {
    for (const mode of ["stowed", "dry"]) {
      let world = run({ op: "create", seed });
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
      const carry = mode === "dry" ? "lamp" : "";
      const pond = play(world, "move:vale::pond");
      station = play(pond, `move:vale:${carry}:station`);
      if (mode === "dry")
        station.actors = Object.fromEntries(
          Object.entries(station.actors).toSorted(),
        );
      read = play(station, "read:vale:keeper-log:");
      accepted = play(read, "accept:vale::keeper");
      for (const [target, saved, turn] of [
        ["behind-station", station, 3],
        ["pond", accepted, 4],
      ]) {
        const prior = structuredClone(saved);
        const roads = prior.routeKnowledge[bard];
        const forgotten = seed === 42;
        if (forgotten) {
          const index = roads.findIndex(
            ([from]) => from === prior.actors[bard].place,
          );
          assert.ok(index >= 0);
          roads.splice(index, 1);
        }
        const action = `move:vale:${carry}:${target}`;
        const [before, after] = observe(
          prior,
          mode === "dry" ? { key: action } : action,
        );
        const label = `${seed} ${mode} ${target}`;
        assert.deepEqual(copy(reference.bardPlays), [`wait:${bard}::`], label);
        assert.equal(after.turn, turn, label);
        assert.equal(after.eventSeq, before.eventSeq, label);
        assert.equal(after.actors[bard].dwellUntil, 26, label);
        assert.equal(
          after.routeKnowledge[bard].length,
          roads.length + Number(forgotten),
          label,
        );
        const actual = wasm({ op, world: before });
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: after }), label);
        sample = before;
      }
    }
  }
  for (const world of [station, read]) {
    const [before] = observe(world, "move:vale::pond");
    assert.equal(wasm({ op, world: before }), null);
  }
  for (const mutate of [
    (world) => {
      world.arrival.fromLocationId = "attic";
    },
    (world) => {
      world.heldActors.push("mara");
    },
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.packs.ratiradio.flags["rati-awake"] = true;
    },
  ]) {
    const world = structuredClone(sample);
    mutate(world);
    assert.equal(wasm({ op, world }), null);
  }
  reference.setupBard = (world) => {
    world.actors[bard].dwellUntil = world.turn;
  };
  const [expired] = observe(accepted, "move:vale::pond");
  assert.match(reference.bardPlays[0], /^move:greek-rhapsode::/);
  assert.equal(wasm({ op, world: expired }), null);
});

test("Bard dwell and offstage walks match when Pip follows to historic Station", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceDwellAndWalkers);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const run = (request) => {
    const result = pinned(request);
    assert.equal(result.ok, true, result.error);
    return result.world;
  };
  let ada;
  let quiet;
  for (const seed of [17, 99]) {
    const initial = run({ op: "create", history: true, seed });
    const saved = run({ op: "create", save: JSON.stringify(initial) });
    for (const dry of [false, true]) {
      let world = structuredClone(saved);
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      } else {
        world = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
      }
      const pond = run({
        ...seats,
        op: "play",
        world,
        action: "move:vale::pond",
      });
      const roads = pond.routeKnowledge[bard];
      if (dry) {
        const index = roads.findIndex(
          ([from]) => from === pond.actors[bard].place,
        );
        assert.ok(index >= 0);
        roads.splice(index, 1);
      }
      for (const sorted of [false, true]) {
        const actors = sorted
          ? Object.fromEntries(Object.entries(pond.actors).toSorted())
          : pond.actors;
        reference.bardPlays = [];
        const key = dry ? "move:vale:lamp:station" : "move:vale::station";
        const result = JSON.parse(
          reference.cardShared(
            JSON.stringify({
              ...seats,
              op: "play",
              world: { ...pond, actors },
              action: sorted ? { key } : key,
            }),
          ),
        );
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(copy(reference.bardPlays), [`wait:${bard}::`]);
        const before = copy(reference.beforeBard);
        const after = copy(reference.beforeLife);
        assert.equal(before.log.at(-1).actorId, seed === 99 ? "ada" : "moth");
        assert.equal(
          after.routeKnowledge[bard].length,
          roads.length + Number(dry),
        );
        const actual = wasm({ op: "opening_bard_dwell", world: before });
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${seed}/${dry}/${sorted}`,
        );
        const walk = copy(reference.beforeWalk);
        const walked = copy(reference.afterWalk);
        const acted = copy(reference.acted);
        assert.deepEqual(copy(reference.moves), []);
        assert.ok(
          isDeepStrictEqual(wasm({ op: "opening_history_walkers", world: walk, acted }), {
            ok: true,
            world: walked,
          }),
          `walks ${seed}/${dry}/${sorted}`,
        );
        if (seed === 99) ada = before;
        else quiet = before;
      }
    }
  }
  ada.log.at(-1).targetId = "greek-piraeus";
  assert.equal(wasm({ op: "opening_bard_dwell", world: ada }), null);
  quiet.actors.keeper.sleeping.until += 1;
  assert.equal(wasm({ op: "opening_bard_dwell", world: quiet }), null);
});
