import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "wait:vale::";

function firstDifference(actual, expected, path = []) {
  if (isDeepStrictEqual(actual, expected)) return null;
  if (
    !actual ||
    !expected ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    return path.join(".");
  }
  for (const field of new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ])) {
    const different = firstDifference(actual[field], expected[field], [
      ...path,
      field,
    ]);
    if (different) return different;
  }
  return path.join(".");
}

test("the quiet first attic Wait matches the whole pinned response with and without history", async () => {
  const { pinned, wasm } = await reducers();
  const options = [
    ...[undefined, 0, 17, 4242, 4294967295].map((seed) => ({ seed })),
    ...[undefined, 0, 2, 17, 42, 4242, 4294967295].map((seed) => ({
      seed,
      history: true,
    })),
  ];
  for (const { seed, history } of options) {
    for (const stowed of [false, true]) {
      const created = pinned({ op: "create", seed, history });
      assert.equal(created.ok, true, created.error);
      const world = stowed
        ? pinned({
            ...seats,
            op: "hold",
            world: created.world,
            choice: { item: null, revision: created.world.revision },
          }).world
        : created.world;
      const sorted = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
      const sortedSave = { ...world, actors: sorted };
      if (history && world.placeCard) {
        sortedSave.placeCard = Object.fromEntries(
          Object.entries(world.placeCard).toSorted(),
        );
      }
      for (const saved of [world, sortedSave]) {
        const request = {
          ...seats,
          op: "play",
          world: saved,
          action: stowed ? { key } : key,
        };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        const variant = JSON.stringify({ seed, history, stowed });
        assert.ok(actual, `${variant}: unsupported`);
        const difference = firstDifference(actual, expected);
        assert.equal(
          difference,
          null,
          `${variant} at ${difference}`,
        );
        assert.ok(actual.events.some((entry) => entry.verb === "take"));
        assert.ok(
          actual.events.some((entry) => entry.actorId === "greek-rhapsode"),
        );
      }
    }
  }
});
