import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

test("resets Vale's opening seat, custody, and progress like the pinned rules", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  for (const seed of [0, 7, 4242]) {
    for (const setup of [
      {},
      { hidden: "nell", absent: ["mara", "ash"] },
      { history: true },
    ]) {
      const fresh = pinned({ op: "create", seed, ...setup }).world;
      const joined = pinned({
        ...seats,
        op: "join",
        world: fresh,
        progress: { level: 3, xp: 7, upgrades: ["scarf-gold"] },
      });
      assert.equal(joined.ok, true, joined.error);
      joined.world.actors.mara.trust.vale = 2;
      joined.world.memories.vale.text = "An earlier memory.";
      joined.world.memories.vale.turn = joined.world.turn;
      const stowed = pinned({
        ...seats,
        op: "hold",
        world: joined.world,
        choice: { item: null, revision: joined.world.revision },
      });
      assert.equal(stowed.ok, true, stowed.error);
      for (const world of [fresh, joined.world, stowed.world]) {
        const request = { ...seats, op: "reset", world };
        const ref = pinned(request);
        assert.equal(ref.ok, true, ref.error);
        assert.deepEqual(wasm(request), ref);
        assert.equal(ref.world.actors.vale.xp, 0);
        assert.equal(ref.world.actors.vale.upgrades, undefined);
        assert.equal(ref.world.actors.mara.trust.vale, 0);
        assert.equal(ref.world.memories.vale.text, null);
        assert.equal(ref.world.memories.vale.events[0].turn, 0);
        assert.equal(ref.world.turn, world.turn);
        assert.equal(ref.world.items.lamp.holder, "attic");
        assert.equal(ref.world.items.lamp.lit, true);

        const repeated = {
          ...request,
          world: ref.world,
          claimed: [],
          present: [],
        };
        assert.deepEqual(wasm(repeated), pinned(repeated));
      }
    }
  }
});

test("leaves resets outside the ported opening state unsupported", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({ op: "create", seed: 0 }).world;
  const request = {
    op: "reset",
    actor: "mara",
    world,
    claimed: [],
    present: [],
  };
  assert.equal(wasm(request), null);
  assert.equal(wasm({ ...request, actor: "vale", present: ["vale"] }), null);
  const played = pinned({
    ...request,
    op: "play",
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
    action: "wait:vale::",
  });
  assert.equal(played.ok, true, played.error);
  assert.equal(wasm({ ...request, actor: "vale", world: played.world }), null);
});
