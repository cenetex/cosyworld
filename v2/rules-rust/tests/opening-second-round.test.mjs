import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wait = "wait:vale::";
const drop = "drop:vale:lamp:attic";
const take = "take:vale:lamp:";

test("the second attic player and resident rounds match pinned working states", async () => {
  const { pinned, wasm } = await reducers();
  const round =
    "    residentRound(next, [...cast, ...lightPlays(next, round2, cast)]);";
  const reference = currentSharedEngine((source) => {
    assert.equal(source.split(round).length, 2);
    return source.replace(
      round,
      "$&\n    globalThis.afterResidents = structuredClone(next);",
    );
  });
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const mode of ["held", "stowed", "dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
        world = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      for (const [first, second] of [
        [wait, wait],
        [drop, take],
      ]) {
        const prior = pinned({ ...seats, op: "play", world, action: first });
        assert.equal(prior.ok, true, prior.error);
        const play = {
          ...seats,
          op: "play",
          world: prior.world,
          action: second,
        };
        const result = JSON.parse(reference.cardShared(JSON.stringify(play)));
        assert.equal(result.ok, true, result.error);
        const expected = JSON.parse(JSON.stringify(reference.afterResidents));
        const label = `${seed} ${mode} ${second}`;
        const actual = wasm({ ...play, op: "opening_second_resident_round" });
        assert.ok(actual?.ok, label);
        assert.deepEqual(
          Object.keys(actual.world).sort(),
          Object.keys(expected).sort(),
          label,
        );
        for (const [key, value] of Object.entries(expected)) {
          assert.deepEqual(actual.world[key], value, `${label} ${key}`);
        }
      }
    }
  }
});
