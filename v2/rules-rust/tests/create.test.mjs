import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

test("fresh Vale worlds match the complete pinned create response", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [null, 0, 1, 5, 17, 42, 97, 4242, 65_537, 2_147_483_648, 4_294_967_295]) {
    for (const history of [false, true]) {
      const request = { op: "create", save: null, seed, history };
      const expected = pinned(request);
      const actual = wasm(request);
      const field = Object.keys(expected).find(
        (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
      );
      assert.equal(expected.ok, true);
      assert.equal(field, undefined, `seed ${seed}, history ${history} differs in ${field}`);
      assert.ok(isDeepStrictEqual(actual, expected));
    }
  }
});

test("fresh create reports unsupported options outside the parity scope", async () => {
  const { wasm } = await reducers();
  for (const args of [
    { seed: "4242" },
    { seed: 4_294_967_296 },
    { hidden: "mara" },
    { absent: ["mara"] },
    { homecoming: "mara" },
    { actor: "mara" },
  ]) {
    assert.equal(wasm({ op: "create", ...args }), null);
  }
});
