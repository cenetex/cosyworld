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

test("one returned place card records the pinned history completion and memory", async () => {
  const { pinned, wasm } = await reducers();
  for (const { seed, packRoom } of [
    { seed: 2 },
    { seed: 42 },
    { packRoom: "ratiradio-broadcast-booth" },
  ]) {
    for (const stowed of [false, true]) {
      let { world } = pinned({ op: "create", seed, history: true });
      if (packRoom) {
        assert.ok(world.placeCard[packRoom]);
        world.placeCard = { [packRoom]: world.placeCard[packRoom] };
      }
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
      const event = expected.events[1];
      assert.equal(event.verb, "want_met");
      assert.deepEqual(wasm({ ...request, op: "opening_place_return" }), {
        ok: true,
        events: [event],
        placeCard: expected.world.placeCard,
        placeMet: expected.world.placeMet,
        memories: Object.fromEntries(
          ["vale", "attic", "lamp"].map((id) => [
            id,
            expected.world.memories[id],
          ]),
        ),
      });
    }
  }
});

test("simultaneous history returns use the caller's saved card order", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create", history: true });
  const cards = Object.entries(world.placeCard);
  const returned = cards
    .filter(([home, item]) => world.items[item].holder === home)
    .map(([home]) => home);
  assert.ok(returned.length > 1);
  for (const reversed of [false, true]) {
    const placeCard = Object.fromEntries(reversed ? cards.toReversed() : cards);
    const request = {
      ...seats,
      world: { ...world, placeCard },
      action: "wait:vale::",
    };
    const expected = pinned({ ...request, op: "play" });
    assert.equal(expected.ok, true, expected.error);
    const events = expected.events.filter((entry) => entry.verb === "want_met");
    assert.deepEqual(
      events.map((entry) => entry.ownerId),
      reversed ? returned.toReversed() : returned,
    );
    assert.deepEqual(wasm({ ...request, op: "opening_place_return" }), {
      ok: true,
      events,
      placeCard: expected.world.placeCard ?? null,
      placeMet: expected.world.placeMet,
      memories: Object.fromEntries(
        ["vale", "attic", "lamp"].map((id) => [
          id,
          expected.world.memories[id],
        ]),
      ),
    });
  }
});
