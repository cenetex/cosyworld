import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_second_attic_life";

test("the second attic turn preserves the pinned offstage resident state", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const life =
      "    residentRound(next, [...cast, ...lightPlays(next, round2, cast)]);";
    assert.equal(source.split(life).length, 2);
    return source.replace(
      life,
      "    globalThis.beforeLife = structuredClone(next);\n$&\n    globalThis.afterLife = structuredClone(next);",
    );
  });
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    const { world } = pinned({ op: "create", seed });
    for (const [first, second] of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const prior = pinned({ ...seats, op: "play", world, action: first });
      assert.equal(prior.ok, true, prior.error);
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: prior.world,
            action: second,
          }),
        ),
      );
      assert.equal(reply.ok, true, reply.error);
      const before = JSON.parse(JSON.stringify(reference.beforeLife));
      const after = JSON.parse(JSON.stringify(reference.afterLife));
      assert.deepEqual(before, after, `${seed} ${second}`);
      assert.deepEqual(wasm({ op, world: before }), { ok: true, world: after });
      before.actors.moth.homeward = true;
      assert.equal(wasm({ op, world: before }), null);
    }
  }
});
