import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wait = "wait:vale::";

test("the second attic Wait records the pinned player phase", async () => {
  const { pinned, wasm } = await reducers();
  const perform =
    "    const respondent = perform(next, exact, round2, residents2);";
  const reference = currentSharedEngine((source) => {
    assert.equal(source.split(perform).length, 2);
    return source.replace(
      perform,
      "$&\n    globalThis.afterPlayer = structuredClone(next);",
    );
  });
  let last;
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const mode of ["held", "stowed", "dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
        world = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const first = pinned({ ...seats, op: "play", world, action: wait });
      assert.equal(first.ok, true, first.error);
      const spoken = pinned({
        ...seats,
        op: "speech",
        world: first.world,
        room: "attic",
        entries: [],
        lines: [{ entityId: "vale", actorId: "vale", text: "I'll wait here." }],
      });
      assert.equal(spoken.ok, true, spoken.error);
      for (const prior of [first.world, spoken.world]) {
        const play = { ...seats, op: "play", world: prior, action: wait };
        const result = JSON.parse(reference.cardShared(JSON.stringify(play)));
        const label = `${seed} ${mode} revision ${prior.revision}`;
        assert.equal(result.ok, true, result.error);
        const expected = JSON.parse(JSON.stringify(reference.afterPlayer));
        last = { ...play, op: "opening_second_wait_step" };
        const actual = wasm(last);
        assert.ok(actual?.ok, label);
        assert.deepEqual(
          Object.keys(actual.world).sort(),
          Object.keys(expected).sort(),
        );
        for (const [key, value] of Object.entries(expected)) {
          assert.deepEqual(actual.world[key], value, `${label} ${key}`);
        }
      }
    }
  }
  assert.equal(wasm({ ...last, revision: 0 }), null);
  assert.equal(wasm({ ...last, action: "sleep:vale::" }), null);
  assert.equal(wasm({ ...last, present: [] }), null);
  const fromDrop = structuredClone(last.world);
  fromDrop.log.find((entry) => entry.verb === "wait").verb = "drop";
  assert.equal(wasm({ ...last, world: fromDrop }), null);
});
