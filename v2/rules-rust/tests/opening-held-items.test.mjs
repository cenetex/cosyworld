import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const marker = "    settleStrandedWayfinder(next);\n    settleHeldItems(next, handSnapshot(s));";

function tracedHands() {
  return currentSharedEngine((source) => {
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, `
      settleStrandedWayfinder(next);
      globalThis.finalHands = {before: structuredClone(s), world: structuredClone(next)};
      globalThis.settleHands = (world, before) => {
        settleHeldItems(world, before ? handSnapshot(before) : null);
        return JSON.stringify(world);
      };
      settleHeldItems(next, handSnapshot(s));
      globalThis.finalHands.expected = structuredClone(next);`);
  });
}

test("final held cards match the pinned second attic Wait and lamp Take", async () => {
  const { wasm } = await reducers();
  const reference = tracedHands();
  const play = (request) => JSON.parse(reference.cardShared(JSON.stringify(request)));
  for (const seed of [undefined, 0, 17, 4242, 4_294_967_295]) {
    for (const keys of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const { world } = play({ op: "create", seed });
      const first = play({ ...seats, op: "play", world, action: keys[0] });
      assert.equal(first.ok, true, first.error);
      const second = play({ ...seats, op: "play", world: first.world, action: keys[1] });
      assert.equal(second.ok, true, second.error);
      const trace = JSON.parse(JSON.stringify(reference.finalHands));
      const actual = wasm({ op: "opening_final_hands", before: trace.before, world: trace.world });
      assert.deepEqual(actual, { ok: true, world: trace.expected });
    }
  }
});

test("receipts preserve a selected new card or choose the last arrived card", async () => {
  const { wasm } = await reducers();
  const reference = tracedHands();
  const play = (request) => JSON.parse(reference.cardShared(JSON.stringify(request)));
  const { world: start } = play({ op: "create" });
  const played = play({ ...seats, op: "play", world: start, action: "wait:vale::" });
  assert.equal(played.ok, true, played.error);
  for (const [heldItem, receipt, expected] of [
    ["cloth", true, "cloth"],
    [null, true, "oil"],
    [null, false, null],
    ["oil", false, "lamp"],
    [undefined, false, "lamp"],
  ]) {
    const world = structuredClone(played.world);
    world.actors.vale.heldItem = heldItem;
    if (receipt) {
      world.items.cloth.holder = "vale";
      world.items.oil.holder = "vale";
    }
    const before = receipt ? played.world : undefined;
    const wanted = JSON.parse(reference.settleHands(structuredClone(world), before));
    assert.equal(wanted.actors.vale.heldItem, expected);
    assert.deepEqual(wasm({ op: "opening_final_hands", world, before }), { ok: true, world: wanted });
  }
});
