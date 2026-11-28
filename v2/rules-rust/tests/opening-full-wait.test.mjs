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

test("the quiet solo attic Wait matches the entire pinned play response", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    for (const stowed of [false, true]) {
      const created = pinned({ op: "create", seed });
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
      for (const actors of [world.actors, sorted]) {
        const request = {
          ...seats,
          op: "play",
          world: { ...world, actors },
          action: stowed ? { key } : key,
        };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        assert.ok(actual, `seed ${seed}, stowed ${stowed}: unsupported`);
        const difference = firstDifference(actual, expected);
        assert.equal(
          difference,
          null,
          `seed ${seed}, stowed ${stowed} at ${difference}`,
        );
        assert.ok(actual.events.some((entry) => entry.verb === "take"));
        assert.ok(
          actual.events.some((entry) => entry.actorId === "greek-rhapsode"),
        );
      }
    }
  }
});
