import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "wait:vale::";
const visitors = ["mara", "ash", "nell", "tavi", "rue", "orin", "ada"];

test("first attic Wait with hidden and absent seats matches the complete pinned round", async () => {
  const { pinned, wasm } = await reducers();
  const scenarios = [
    ...[0, 1, 2, 3, 4, 5].map((seed) => ({
      seed,
      hidden: "mara",
      absent: seed % 2 ? ["ash", "nell"] : undefined,
    })),
    { seed: 42, hidden: "ada", absent: visitors.filter((id) => id !== "ada") },
    { absent: ["ash"] },
    { absent: visitors },
  ];
  const hidingPlaces = new Set();
  for (const history of [false, true]) {
    for (const setup of scenarios) {
      const created = pinned({ op: "create", ...setup, history });
      assert.equal(created.ok, true, created.error);
      for (const stowed of [false, true]) {
        const world = stowed
          ? pinned({
              ...seats,
              op: "hold",
              world: created.world,
              choice: { item: null, revision: created.world.revision },
            }).world
          : created.world;
        const request = { ...seats, op: "play", world, action };
        const reference = pinned(request);
        assert.equal(reference.ok, true, reference.error);
        const candidate = wasm(request);
        assert.ok(candidate, JSON.stringify({ setup, history, stowed }));
        assert.ok(
          isDeepStrictEqual(candidate, reference),
          JSON.stringify({ setup, history, stowed }),
        );
        if (world.hidden) {
          const { actor, place } = world.hidden;
          hidingPlaces.add(place);
          assert.ok(candidate.world.actors[actor].visited.includes(place));
        }
      }
    }
  }
  assert.equal(hidingPlaces.size, 6);
});

test("first attic Wait declines inconsistent hidden or absent declarations", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({
    op: "create",
    seed: 17,
    hidden: "mara",
    absent: ["ash"],
  });
  for (const override of [
    { absent: ["ash", "ash"] },
    { absent: ["vale"] },
    { absent: ["mara"] },
    { hidden: { ...world.hidden, met: ["vale"] } },
    { hidden: { ...world.hidden, place: "pond" } },
  ]) {
    assert.equal(
      wasm({ ...seats, op: "play", world: { ...world, ...override }, action }),
      null,
    );
  }
});

test("first attic Wait declines a hidden visitor's potentially completed item want", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create", hidden: "mara" });
  world.items.mask.holder = "mara";
  world.actors.mara.want = { kind: "item", target: "mask", since: 0, refusals: 0 };
  const request = { ...seats, op: "play", world, action };
  assert.equal(pinned(request).ok, true);
  assert.equal(wasm(request), null);
});
