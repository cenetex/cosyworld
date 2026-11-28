import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const bard = "greek-rhapsode";
const life = "    residentRound(next, [...cast, ...lightPlays(next, round2, cast)]);";

function traceLife(source) {
  const roaming = "    for (const id of roamingActors) {";
  assert.equal(source.split(roaming).length, 2);
  assert.equal(source.split(life).length, 2);
  return source
    .replace(roaming, `    globalThis.beforeBard = structuredClone(next);\n${roaming}`)
    .replace(life, `    globalThis.beforeLife = structuredClone(next);\n${life}
    globalThis.afterLife = structuredClone(next);`);
}

test("second Pond arrival uses pinned Bard dwell and offstage resident settlement", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceLife);
  const movers = new Set();
  let state;
  for (const seed of [undefined, 0, 2, 17, 4242, 4_294_967_295]) {
    for (const mode of ["stowed", "dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
        ({ world } = pinned({
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        }));
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const waited = pinned({ ...seats, op: "play", world, action: "wait:vale::" });
      assert.equal(waited.ok, true, waited.error);
      const routes = waited.world.routeKnowledge[bard];
      const forgotten = mode === "dry" && seed === 17;
      if (forgotten) {
        const road = routes.findIndex(([from]) => from === waited.world.actors[bard].place);
        assert.ok(road >= 0);
        routes.splice(road, 1);
      }
      for (const key of ["move:vale::pond", "move:vale:lamp:pond"]) {
        const request = { ...seats, op: "play", world: waited.world, action: key };
        const played = JSON.parse(reference.cardShared(JSON.stringify(request)));
        assert.equal(played.ok, true, played.error);
        for (const event of played.events) {
          if (event.verb === "move" && event.actorId !== "vale") movers.add(event.actorId);
        }
        const { beforeBard, beforeLife, afterLife } = JSON.parse(JSON.stringify({
          beforeBard: reference.beforeBard,
          beforeLife: reference.beforeLife,
          afterLife: reference.afterLife,
        }));
        const label = JSON.stringify({ seed, mode, key });
        assert.equal(beforeLife.eventSeq, beforeBard.eventSeq, label);
        assert.equal(beforeLife.routeKnowledge[bard].length, routes.length + Number(forgotten), label);
        assert.deepEqual(wasm({ op: "opening_bard_dwell", world: beforeBard }), { ok: true, world: beforeLife }, label);
        assert.deepEqual(wasm({ op: "opening_second_pond_life", world: beforeLife }), { ok: true, world: afterLife }, label);
        state = beforeLife;
      }
    }
  }
  assert.deepEqual([...movers].sort(), ["ash", "nell", "orin"]);
  const invalid = structuredClone(state);
  invalid.arrival.fromLocationId = "station";
  assert.equal(wasm({ op: "opening_second_pond_life", world: invalid }), null);
  assert.equal(wasm({ op: "opening_bard_dwell", world: invalid }), null);
  state.actors.moth.homeward = true;
  assert.equal(wasm({ op: "opening_second_pond_life", world: state }), null);
});
