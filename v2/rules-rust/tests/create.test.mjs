import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

test("fresh Vale worlds replay the complete unseeded pinned response", async () => {
  const { pinned, wasm } = await reducers();
  for (const history of [false, true]) {
    const request = { op: "create", save: null, history };
    const expected = pinned(request);
    const actual = wasm(request);
    const field = Object.keys(expected).find(
      (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
    );
    assert.equal(expected.ok, true);
    assert.equal(field, undefined, `history ${history} differs in ${field}`);
    assert.ok(isDeepStrictEqual(actual, expected));
  }
});

test("fresh create leaves to other reducers the opening options it cannot replay", async () => {
  const { wasm } = await reducers();
  for (const args of [
    { seed: 4242 },
    { hidden: "mara" },
    { absent: ["mara"] },
    { homecoming: "mara" },
    { actor: "mara" },
  ]) {
    assert.equal(wasm({ op: "create", ...args }), null);
  }
});
