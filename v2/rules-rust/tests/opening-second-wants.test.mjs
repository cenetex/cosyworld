import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_second_attic_wants";

function capture(source) {
  const start = "    reviseStalledWants(\n      next,";
  const end = "    fillWants(next, wantAPI(next));";
  assert.equal(source.split(start).length, 2);
  assert.equal(source.split(end).length, 2);
  return source
    .replace(start, "    globalThis.beforeWants = structuredClone(next);\n$&")
    .replace(end, "$&\n    globalThis.afterWants = structuredClone(next);");
}

test("a second attic Wait or Take settles wants exactly when residents stay or move", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capture);
  let moved = false;
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
      moved ||= reply.events.some(
        ({ actorId, verb }) => actorId !== "vale" && verb === "move",
      );
      const before = JSON.parse(JSON.stringify(reference.beforeWants));
      const after = JSON.parse(JSON.stringify(reference.afterWants));
      const actual = wasm({ op, world: before });
      assert.ok(actual, `${seed} ${second}`);
      const changed = Object.keys(after).find(
        (key) => !isDeepStrictEqual(actual.world[key], after[key]),
      );
      assert.equal(changed, undefined, `${seed} ${second}`);
      assert.deepEqual(
        Object.keys(actual.world).sort(),
        Object.keys(after).sort(),
      );

      before.heldActors.push("mara");
      assert.equal(wasm({ op, world: before }), null);
    }
  }
  assert.ok(moved);
});
