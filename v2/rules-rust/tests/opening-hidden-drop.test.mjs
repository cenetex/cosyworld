import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "drop:vale:lamp:attic";
const visitors = ["mara", "ash", "nell", "tavi", "rue", "orin", "ada"];

test("first attic lamp Drop with hidden and absent seats matches the complete pinned round", async () => {
  const { pinned, wasm } = await reducers();
  const scenarios = [
    { hidden: "nell" },
    { seed: 1, hidden: "mara", absent: ["ash", "nell"] },
    { seed: 5, hidden: "mara" },
    { seed: 42, hidden: "ada", absent: visitors.filter((id) => id !== "ada") },
    { absent: visitors },
  ];
  for (const history of [false, true]) {
    for (const setup of scenarios) {
      const created = pinned({ op: "create", ...setup, history });
      assert.equal(created.ok, true, created.error);
      for (const lamp of ["held", "stowed", "dry"]) {
        const world = lamp === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: created.world,
              choice: { item: null, revision: created.world.revision },
            }).world
          : structuredClone(created.world);
        if (lamp === "dry") {
          Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        }
        if (history) {
          world.actors = Object.fromEntries(Object.entries(world.actors).toSorted());
          world.placeCard = Object.fromEntries(Object.entries(world.placeCard).toSorted());
        }
        const request = { ...seats, op: "play", world, action };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        const variant = JSON.stringify({ setup, history, lamp });
        assert.ok(actual, `${variant}: unsupported`);
        assert.ok(isDeepStrictEqual(actual, expected), variant);
        assert.equal(actual.world.items.lamp.holder, "attic");
      }
    }
  }
});
