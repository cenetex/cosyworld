import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "drop:vale:lamp:attic";

test("the first quiet attic Drop matches the complete pinned round", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    for (const lamp of ["held", "stowed", "dry"]) {
      const fresh = pinned({ op: "create", seed });
      assert.equal(fresh.ok, true, fresh.error);
      const world =
        lamp === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: fresh.world,
              choice: { item: null, revision: fresh.world.revision },
            }).world
          : fresh.world;
      if (lamp === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      const sorted = Object.fromEntries(Object.entries(world.actors).toSorted());
      for (const actors of [world.actors, sorted]) {
        const request = {
          ...seats,
          op: "play",
          world: { ...world, actors },
          action: actors === sorted ? { key } : key,
        };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        assert.ok(actual, `seed ${seed}, lamp ${lamp}: unsupported`);
        assert.deepEqual(actual, expected, `seed ${seed}, lamp ${lamp}`);
        assert.equal(actual.events[0].verb, "drop");
        assert.equal(actual.world.items.lamp.holder, "attic");
        assert.ok(actual.events.some((event) => event.verb === "take"));
        assert.equal(
          actual.events.at(-1).text ===
            "The attic mirror's path to the pond closes.",
          lamp === "stowed",
        );
        assert.ok(!actual.actions.some((action) => action.sleep));
        assert.deepEqual(actual.exits, lamp === "dry" ? ["pond"] : []);
      }
    }
  }
});
