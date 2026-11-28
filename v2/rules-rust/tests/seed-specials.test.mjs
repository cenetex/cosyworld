import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../../card-game/world.mjs";
import { reducers } from "./parity.mjs";

function placement(world) {
  return Object.fromEntries(
    Object.entries(world.actors)
      .filter(([id]) => id.startsWith("hoppycat-"))
      .map(([id, actor]) => [id, actor.place]),
  );
}

test("seeded specials match the pinned draws and archive resident placements", async () => {
  const { pinned, wasm } = await reducers();
  const world = createWorld({ opening: true });
  for (const seed of [0, 1, 2, 3, 4, 5, 7, 17, 42, 4242, 4_294_967_295]) {
    const reference = pinned({ op: "create", seed });
    assert.equal(reference.ok, true, reference.error);
    const actual = wasm({ op: "seed_specials", seed, world });
    assert.ok(actual, `seed ${seed} was unsupported`);
    const draws = (state) =>
      Object.fromEntries(
        Object.entries(state.packs).map(([id, pack]) => [id, pack.specials]),
      );
    assert.deepEqual(
      draws(actual.world),
      draws(reference.world),
      `draw at seed ${seed}`,
    );
    assert.deepEqual(
      placement(actual.world),
      placement(reference.world),
      `placement at seed ${seed}`,
    );
    assert.equal(
      wasm({ op: "seed_specials", seed, world: actual.world }),
      null,
    );
  }
});
