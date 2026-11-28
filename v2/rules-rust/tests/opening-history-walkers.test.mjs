import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const copy = (world) => JSON.parse(JSON.stringify(world));

function observeWalkers(source) {
  const begin = "    const dawnOrDusk = s.turn % DAYLIGHT_TURNS === 0;";
  const end = "    if (!moved2.length) return;";
  assert.equal(source.split(begin).length, 2);
  assert.equal(source.split(end).length, 2);
  return source
    .replace(
      begin,
      `    globalThis.setupWalk?.(s);
    globalThis.beforeWalk = structuredClone(s);
    globalThis.acted = structuredClone(acted);
${begin}`,
    )
    .replace(
      end,
      `    globalThis.afterWalk = structuredClone(s);
    globalThis.moves = structuredClone(moved2);
${end}`,
    );
}

test("first historic Wait proves the pinned offstage walkers leave no changes", async () => {
  const { pinned, wasm } = await reducers();
  const observed = currentSharedEngine(observeWalkers);
  for (const seed of [undefined, 0, 1, 17, 42, 4242, 4255, 4294967295]) {
    const fresh = pinned({ op: "create", history: true, seed });
    assert.equal(fresh.ok, true, fresh.error);
    const play = {
      op: "play",
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      world: fresh.world,
      action: "wait:vale::",
    };
    assert.equal(JSON.parse(observed.cardShared(JSON.stringify(play))).ok, true);
    const before = copy(observed.beforeWalk);
    const after = copy(observed.afterWalk);
    assert.deepEqual(copy(observed.moves), []);
    assert.ok(before.actors.whiskerwind.dwellUntil > before.turn);
    assert.equal(before.actors["greek-antigone"].place, "greek-gate");
    assert.deepEqual(
      wasm({
        op: "opening_history_walkers",
        world: before,
        acted: copy(observed.acted),
      }),
      { ok: true, world: after },
      `seed ${seed}`,
    );

    if (seed !== 4242) continue;
    observed.setupWalk = (state) => {
      state.actors.whiskerwind.dwellUntil = state.turn;
      state.actors.whiskerwind.homeward = true;
    };
    observed.cardShared(JSON.stringify(play));
    assert.deepEqual(copy(observed.moves), ["whiskerwind"]);
    assert.equal(
      wasm({
        op: "opening_history_walkers",
        world: copy(observed.beforeWalk),
        acted: copy(observed.acted),
      }),
      null,
    );
    delete observed.setupWalk;
  }
});
