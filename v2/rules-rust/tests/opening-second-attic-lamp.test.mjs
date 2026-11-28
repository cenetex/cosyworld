import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const start = "    settleVoyageCargo(next, voyages, nameOf2, worldLine);\n    settleHeldItems(next, handSnapshot(s));";
const stop = "    wakeSleepers(next, s, voyages);";

test("second attic lamp settlement matches pinned mirror and crossing effects", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    assert.equal(source.split(start).length, 2);
    assert.equal(source.split(stop).length, 2);
    return source
      .replace(start, `${start}
        globalThis.light = {before: structuredClone(s), world: structuredClone(next)};`)
      .replace(stop, `    globalThis.light.after = structuredClone(next);
${stop}`);
  });
  const play = (request) => JSON.parse(reference.cardShared(JSON.stringify(request)));
  let lampDry;
  let lampLit;
  for (const seed of [undefined, 0, 17, 4242, 4_294_967_295]) {
    for (const keys of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      for (const mode of ["held", "stowed", "dry"]) {
        let { world } = play({ op: "create", seed });
        if (mode === "stowed") {
          ({ world } = play({
            ...seats, op: "hold", world,
            choice: { item: null, revision: world.revision },
          }));
        } else if (mode === "dry") {
          Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        }
        const first = play({ ...seats, op: "play", world, action: keys[0] });
        assert.equal(first.ok, true, first.error);
        const second = play({ ...seats, op: "play", world: first.world, action: keys[1] });
        assert.equal(second.ok, true, second.error);
        const trace = JSON.parse(JSON.stringify(reference.light));
        const request = { op: "opening_second_attic_lamp", before: trace.before, world: trace.world };
        assert.deepEqual(wasm(request), { ok: true, world: trace.after });
        if (trace.world.items.lamp.fuel === 0) lampDry = request;
        if (trace.world.items.lamp.lit) lampLit = request;
      }
    }
  }
  lampDry.world.items.oil.holder = "vale";
  assert.equal(wasm(lampDry), null);
  const signaled = structuredClone(lampLit);
  const signal = Object.values(signaled.world.crossings).find((state) => state.phase === 0);
  assert.ok(signal);
  signal.phase = 1;
  assert.equal(wasm(signaled), null);
  lampLit.world.actors.vale.heldItem = null;
  assert.equal(wasm(lampLit), null);
});
