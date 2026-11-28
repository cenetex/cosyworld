import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::pond", "move:vale:lamp:pond"];

function stow(pinned, world) {
  const result = pinned({
    ...seats,
    op: "hold",
    world,
    choice: { item: null, revision: world.revision },
  });
  assert.equal(result.ok, true, result.error);
  return result.world;
}

test("the second quiet pond crossing returns the complete pinned reply", async () => {
  const { pinned, wasm } = await reducers();
  let request;
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const mode of ["stow before Wait", "stow after Wait", "held dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stow before Wait") world = stow(pinned, world);
      if (mode === "held dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const waited = pinned({
        ...seats,
        op: "play",
        world,
        action: "wait:vale::",
      });
      assert.equal(waited.ok, true, waited.error);
      world =
        mode === "stow after Wait" ? stow(pinned, waited.world) : waited.world;
      const spoken = pinned({
        ...seats,
        op: "speech",
        world,
        room: "attic",
        entries: [],
        lines: [{ entityId: "vale", actorId: "vale", text: "Let's cross." }],
      });
      assert.equal(spoken.ok, true, spoken.error);
      for (const saved of [world, spoken.world]) {
        for (const key of routes) {
          const action = saved === world ? key : { key };
          request = {
            ...seats,
            op: "play",
            world: saved,
            action,
            revision: saved.revision,
          };
          const expected = pinned(request);
          assert.equal(expected.ok, true, expected.error);
          const actual = wasm(request);
          const label = `${seed} ${mode} ${key} revision ${saved.revision}`;
          assert.ok(actual?.ok, label);
          assert.deepEqual(
            Object.keys(actual).sort(),
            Object.keys(expected).sort(),
            label,
          );
          for (const [field, value] of Object.entries(expected)) {
            assert.ok(
              isDeepStrictEqual(actual[field], value),
              `${label} ${field}`,
            );
          }
        }
      }
    }
  }
  assert.equal(wasm({ ...request, revision: 0 }), null);
  assert.equal(wasm({ ...request, present: [] }), null);
  const forged = structuredClone(request.world);
  forged.log.find((entry) => entry.verb === "wait").generated = true;
  assert.equal(wasm({ ...request, world: forged }), null);
});
