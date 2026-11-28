import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wait = "wait:vale::";
const drop = "drop:vale:lamp:attic";
const take = "take:vale:lamp:";

test("normal play returns the complete pinned second Wait and Take replies", async () => {
  const { pinned, wasm } = await reducers();
  let last;
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const mode of ["held", "stowed", "dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
        const stowed = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(stowed.ok, true, stowed.error);
        world = stowed.world;
      }
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      for (const [first, second] of [
        [wait, wait],
        [drop, take],
      ]) {
        const before = pinned({ ...seats, op: "play", world, action: first });
        assert.equal(before.ok, true, before.error);
        const spoken = pinned({
          ...seats,
          op: "speech",
          world: before.world,
          room: "attic",
          entries: [],
          lines: [
            { entityId: "vale", actorId: "vale", text: "The attic is quiet." },
          ],
        });
        assert.equal(spoken.ok, true, spoken.error);
        for (const prior of [before.world, spoken.world]) {
          const action = prior === before.world ? second : { key: second };
          last = {
            ...seats,
            op: "play",
            world: prior,
            action,
            revision: prior.revision,
          };
          const expected = pinned(last);
          assert.equal(expected.ok, true, expected.error);
          const label = `${seed} ${mode} ${second} revision ${prior.revision}`;
          const actual = wasm(last);
          assert.ok(actual?.ok, label);
          assert.deepEqual(
            Object.keys(actual).sort(),
            Object.keys(expected).sort(),
            label,
          );
          for (const [key, value] of Object.entries(expected)) {
            assert.deepEqual(actual[key], value, `${label} ${key}`);
          }
        }
      }
    }
  }
  assert.equal(wasm({ ...last, revision: 0 }), null);
  assert.equal(wasm({ ...last, claimed: ["mara", "vale"] }), null);
  assert.equal(wasm({ ...last, action: "sleep:vale::" }), null);
});
