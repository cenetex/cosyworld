import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "wait:vale::";
const fields = new Set([
  "want",
  "under",
  "content",
  "gaveUp",
  "heardOn",
  "offered",
]);

function wants(world) {
  return Object.fromEntries(
    Object.entries(world.actors).map(([id, actor]) => [
      id,
      Object.fromEntries(
        Object.entries(actor).filter(([field]) => fields.has(field)),
      ),
    ]),
  );
}

test("first-wait want clocks and eligible quest state match the full pinned round", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 17, hidden: "mara", absent: ["ash"] },
  ]) {
    let { world } = pinned({ op: "create", ...options });
    for (const pick of [false, true]) {
      if (pick) {
        const accepted = pinned({
          ...seats,
          op: "play",
          world,
          action: "accept:vale::box:pond",
        });
        assert.equal(accepted.ok, true, accepted.error);
        world = accepted.world;
      }
      const request = { ...seats, world, action };
      const result = pinned({ ...request, op: "play" });
      assert.equal(result.ok, true, result.error);
      const original = wants(world);
      const after = wants(result.world);
      assert.ok(
        Object.keys(after).filter(
          (id) => original[id].want?.since !== after[id].want?.since,
        ).length >= 13,
      );
      assert.deepEqual(wasm({ ...request, op: "opening_wait_wants" }), {
        ok: true,
        wants: after,
      });
    }
  }
});

test("the first-wait scope declines aged wants, nonzero refusals and a lost quest", async () => {
  const { pinned, wasm } = await reducers();
  const base = { ...seats, action, op: "opening_wait_wants" };
  const history = pinned({ op: "create", history: true }).world;
  assert.equal(wasm({ ...base, world: history }), null);
  const fresh = pinned({ op: "create" }).world;
  const refused = structuredClone(fresh);
  refused.actors["greek-adrastus"].want.refusals = 1;
  assert.equal(wasm({ ...base, world: refused }), null);
  const lost = structuredClone(fresh);
  lost.actors.vale.want = {
    kind: "item",
    target: "greek-bread",
    since: 0,
    refusals: 0,
  };
  lost.gone = ["greek-bread"];
  assert.equal(wasm({ ...base, world: lost }), null);
});
