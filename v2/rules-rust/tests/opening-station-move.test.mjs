import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::station", "move:vale:lamp:station"];
const op = "opening_station_move";

function traceStation(source) {
  const event = "    const sourceSeq = event.seq;";
  assert.equal(source.split(event).length, 2);
  return source.replace(event, `${event}
    if (a.actor === "vale" && a.kind === "move" && a.target === "station") {
      globalThis.stationMove = structuredClone(s);
    }`);
}

test("the quiet first Station movement matches the pinned primary action", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceStation);
  let request;
  for (const seed of [undefined, 2, 4242, 4_294_967_295]) {
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
      for (const waited of [false, true]) {
        const start = waited ? pinned({ ...seats, op: "play", world, action: "wait:vale::" }).world : world;
        const pond = pinned({ ...seats, op: "play", world: start, action: "move:vale::pond" });
        assert.equal(pond.ok, true, pond.error);
        const saved = mode === "stowed" ? pond.world : {
          ...pond.world, actors: Object.fromEntries(Object.entries(pond.world.actors).toSorted()),
        };
        for (const key of routes) {
          request = { ...seats, world: saved, action: waited ? { key } : key, revision: saved.revision };
          reference.stationMove = undefined;
          const played = JSON.parse(reference.cardShared(JSON.stringify({ ...request, op: "play" })));
          assert.equal(played.ok, true, played.error);
          const expected = JSON.parse(JSON.stringify(reference.stationMove));
          const actual = wasm({ ...request, op });
          const label = JSON.stringify({ seed, mode, waited, key });
          assert.ok(actual, `unsupported ${label}`);
          const different = Object.keys(expected).find((field) => !isDeepStrictEqual(actual.world[field], expected[field]));
          assert.equal(different, undefined, label);
          assert.ok(isDeepStrictEqual(actual, { ok: true, world: expected }), label);
          assert.equal(actual.world.opening.met.keeper, saved.turn + 1);
          assert.equal(actual.world.actors.vale.crossed, 1);
          assert.deepEqual(actual.world.actors.vale.visited, saved.actors.vale.visited);
          assert.equal(actual.world.log.at(-1).itemId, key === routes[0] ? null : "lamp");
          assert.equal(actual.world.actors.moth.place, "pond");
        }
      }
    }
  }
  assert.equal(wasm({ ...request, op, revision: request.revision - 1 }), null);
  for (const change of [
    (world) => { world.actors.keeper.place = "behind-station"; },
    (world) => { world.actors.mara.place = "station"; },
  ]) {
    const world = structuredClone(request.world);
    change(world);
    assert.equal(wasm({ ...request, op, world }), null);
  }
});
