import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "drop:vale:lamp:attic";

test("the first quiet attic Drop matches the complete pinned round with and without history", async () => {
  const { pinned, wasm } = await reducers();
  const options = [
    ...[undefined, 0, 17, 4242, 4294967295].map((seed) => ({ seed })),
    ...[undefined, 0, 2, 17, 42, 4242, 4294967295].map((seed) => ({
      seed,
      history: true,
    })),
  ];
  for (const { seed, history } of options) {
    for (const lamp of ["held", "stowed", "dry"]) {
      const fresh = pinned({ op: "create", seed, history });
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
      const sorted = {
        ...world,
        actors: Object.fromEntries(Object.entries(world.actors).toSorted()),
      };
      if (history && world.placeCard)
        sorted.placeCard = Object.fromEntries(
          Object.entries(world.placeCard).toSorted(),
        );
      for (const saved of [world, sorted]) {
        const request = {
          ...seats,
          op: "play",
          world: saved,
          action: saved === sorted ? { key } : key,
        };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        const variant = JSON.stringify({
          seed,
          lamp,
          history,
          sorted: saved === sorted,
        });
        assert.ok(actual, `${variant}: unsupported`);
        assert.deepEqual(actual, expected, variant);
        assert.equal(actual.world.turn, history ? 481 : 1);
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
