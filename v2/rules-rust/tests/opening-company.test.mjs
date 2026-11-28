import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

function observeFade(source) {
  const boundary = "    fadeTrust(next);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `    globalThis.setupFade?.(next);
    globalThis.beforeFade = structuredClone(next);
${boundary}
    globalThis.afterFade = structuredClone(next);`,
  );
}

test("first historic Wait refreshes the pinned resident contacts", async () => {
  const { pinned, wasm } = await reducers();
  const observed = currentSharedEngine(observeFade);
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    const fresh = pinned({ op: "create", history: true, seed });
    assert.equal(fresh.ok, true, fresh.error);
    const response = observed.cardShared(
      JSON.stringify({
        op: "play",
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        world: fresh.world,
        action: "wait:vale::",
      }),
    );
    assert.equal(JSON.parse(response).ok, true);
    const before = JSON.parse(JSON.stringify(observed.beforeFade));
    const after = JSON.parse(JSON.stringify(observed.afterFade));
    assert.equal(before.turn, 481);
    assert.deepEqual(before.actors.whiskerwind.contact.rati, [480, 0]);
    assert.deepEqual(after.actors.whiskerwind.contact.rati, [481, 0]);
    assert.deepEqual(after.actors.whiskerwind.contact.oak, [432, 2]);
    assert.deepEqual(wasm({ op: "opening_fade_trust", world: before }), {
      ok: true,
      world: after,
    });
  }
});

test("stale contacts fade toward their floor at the pinned threshold", async () => {
  const { pinned, wasm } = await reducers();
  const observed = currentSharedEngine(observeFade);
  const fresh = pinned({ op: "create", history: true, seed: 4242 });
  assert.equal(fresh.ok, true, fresh.error);
  observed.setupFade = (world) => {
    world.actors.rati.contact = { moth: [385, 1], vale: [386, 0] };
    world.actors.rati.trust.moth = 3;
    world.actors.rati.trust.vale = 1;
    world.actors.keeper.contact = { vale: [385, 0] };
    world.actors.keeper.trust.vale = 1;
  };
  observed.cardShared(
    JSON.stringify({
      op: "play",
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      world: fresh.world,
      action: "wait:vale::",
    }),
  );
  const before = JSON.parse(JSON.stringify(observed.beforeFade));
  const after = JSON.parse(JSON.stringify(observed.afterFade));
  assert.deepEqual(after.actors.rati.contact, {
    moth: [481, 1],
    vale: [386, 0],
  });
  assert.equal(after.actors.rati.trust.moth, 2);
  assert.equal(after.actors.rati.trust.vale, 1);
  assert.equal(after.actors.keeper.contact, undefined);
  assert.equal(after.actors.keeper.trust.vale, 0);
  assert.deepEqual(wasm({ op: "opening_fade_trust", world: before }), {
    ok: true,
    world: after,
  });
});
