import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.deepEqual([...movers].sort(), ["ash", "nell", "orin"]);
  const badArrival = structuredClone(state);
  badArrival.arrival.fromLocationId = "attic";
  assert.equal(wasm({ op: "opening_bard_dwell", world: badArrival }), null);
  const noFollow = structuredClone(state);
  noFollow.log = noFollow.log.filter((event) => event.seq !== noFollow.arrival.seq + 1);
  assert.equal(wasm({ op: "opening_station_life", world: noFollow }), null);
  state.actors.mara.place = "station";
  assert.equal(wasm({ op: "opening_station_life", world: state }), null);
});
