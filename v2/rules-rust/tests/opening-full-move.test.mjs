import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::pond", "move:vale:lamp:pond"];

function captureCompletedRound(source) {
  const end = "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";
  assert.equal(source.split(end).length, 2);
  return source.replace(end, `${end}
    globalThis.pondRound = structuredClone(next);`);
}

test("first solo mirror movement settles the complete pinned round", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureCompletedRound);
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    const fresh = pinned({ op: "create", seed });
    assert.equal(fresh.ok, true, fresh.error);
    for (const lamp of ["stowed", "held dry"]) {
      const world =
        lamp === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: fresh.world,
              choice: { item: null, revision: fresh.world.revision },
            }).world
          : structuredClone(fresh.world);
      if (lamp === "held dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      const sorted = Object.fromEntries(Object.entries(world.actors).toSorted());
      for (const actors of [world.actors, sorted]) {
        for (const key of routes) {
          const request = {
            ...seats,
            world: { ...world, actors },
            action: actors === sorted ? { key } : key,
          };
          reference.pondRound = undefined;
          const played = JSON.parse(
            reference.cardShared(JSON.stringify({ ...request, op: "play" })),
          );
          assert.equal(played.ok, true, played.error);
          const label = JSON.stringify({ seed, lamp, key });
          const actual = wasm({ ...request, op: "opening_full_move" });
          assert.ok(actual, `unsupported ${label}`);
          const expected = JSON.parse(JSON.stringify(reference.pondRound));
          assert.deepEqual(actual, { ok: true, world: expected }, label);
          assert.equal(actual.world.actors.moth.want.refusals, 1);
          assert.deepEqual(actual.world.actors.vale.waitSpeech, {
            place: "pond",
            turn: null,
          });
          assert.deepEqual(
            actual.world.log.slice(-played.events.length),
            played.events,
          );
        }
      }
    }
  }
});
