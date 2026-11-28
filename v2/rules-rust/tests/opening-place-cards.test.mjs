import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("the quiet opening deals the pinned loose-item place cards", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    for (const stowed of [false, true]) {
      let { world } = pinned({ op: "create", seed });
      if (stowed) {
        world = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      const request = { ...seats, world, action: "wait:vale::" };
      const expected = pinned({ ...request, op: "play" });
      assert.equal(expected.ok, true, expected.error);
      assert.deepEqual(wasm({ ...request, op: "opening_place_cards" }), {
        ok: true,
        placeCard: expected.world.placeCard ?? null,
      });
    }
  }
});

test("place card completion requiring narration stays outside the quiet slice", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create", seed: 4242 });
  world.placeCard = { station: "elysium-wayfinder" };
  world.items["elysium-wayfinder"].holder = "station";
  const request = { ...seats, world, action: "wait:vale::" };
  const expected = pinned({ ...request, op: "play" });
  assert.equal(expected.ok, true, expected.error);
  assert.ok(
    expected.events.some(
      (event) => event.verb === "want_met" && event.ownerId === "station",
    ),
  );
  assert.equal(wasm({ ...request, op: "opening_place_cards" }), null);
});
