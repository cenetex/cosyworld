import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

test("seeded home doors agree with the pinned fresh world and homecomings", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 1, 7, 17, 42, 4242, 4_294_967_295]) {
    for (const homecoming of [
      null,
      "mara",
      "ash",
      "nell",
      "tavi",
      "rue",
      "orin",
      "ada",
    ]) {
      const request = { seed, homecoming };
      const reference = pinned({ ...request, op: "create" });
      assert.equal(reference.ok, true, reference.error);
      assert.deepEqual(
        wasm({ ...request, op: "seed_doors" }),
        {
          ok: true,
          doors: reference.world.doors,
        },
        `seed ${seed}, homecoming ${homecoming}`,
      );
    }
  }
});

test("only an explicit u32 seed and a visitor's home can pick doors", async () => {
  const { wasm } = await reducers();
  for (const seed of [null, -1, 0.5, 4_294_967_296]) {
    assert.equal(wasm({ op: "seed_doors", seed }), null);
  }
  assert.equal(wasm({ op: "seed_doors", seed: 1, homecoming: "vale" }), null);
});
