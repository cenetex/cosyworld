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
    { hidden: "mara", absent: ["mara"] },
    { absent: ["vale"] },
    { homecoming: "vale" },
    { actor: "mara" },
  ]) {
    assert.equal(wasm({ op: "create", ...args }), null);
  }
});


test("fresh absence and homecoming options match the complete pinned response", async () => {
  const { pinned, wasm } = await reducers();
  const visitors = ["mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
  for (const history of [false, true]) {
    for (const [index, actor] of visitors.entries()) {
      const absent = [visitors[(index + 1) % visitors.length]];
      const request = { op: "create", seed: 4242, history, absent, homecoming: actor };
      const reference = pinned(request);
      assert.equal(reference.ok, true);
      assert.ok(isDeepStrictEqual(wasm(request), reference), `${actor} at history ${history}`);
    }
  }
  for (const absent of [["mara"], visitors]) {
    const request = { op: "create", absent };
    assert.ok(isDeepStrictEqual(wasm(request), pinned(request)));
  }
});


test("fresh hidden avatars draw wants using their authored routes", async () => {
  const { pinned, wasm } = await reducers();
  const landings = new Set();
  for (const history of [false, true]) {
    for (const seed of [0, 1, 3, 4, 7, 11]) {
      const request = {
        op: "create", seed, history, hidden: "nell", absent: ["mara"],
        homecoming: "rue",
      };
      const expected = pinned(request);
      assert.equal(expected.ok, true);
      landings.add(expected.world.hidden.place);
      assert.ok(isDeepStrictEqual(wasm(request), expected), `seed ${seed}, history ${history}`);
    }
  }
  assert.equal(landings.size, 6);
});
