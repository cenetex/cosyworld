import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { newest } from "../../scripts/rules-pins.mjs";
import { reducers } from "./parity.mjs";

const seat = { actor: "vale", claimed: ["vale"], present: ["vale"] };

async function versions() {
  const pins = new URL(
    "../../orchestrator-rust/src/card_shared/rules.json",
    import.meta.url,
  );
  const version = newest(await readFile(pins, "utf8"));
  return [version - 1, version].map((number) => `full-card-world/${number}`);
}

test("fully reconstructed opening upgrades advance only the revision", async () => {
  const { pinned, wasm } = await reducers();
  const [previous, current] = await versions();
  for (const seed of [undefined, 0, 4242, 0xffffffff]) {
    for (const history of [false, true]) {
      let { world } = pinned({ op: "create", seed, history });
      for (const [from, claimed, present, item] of [
        [previous, [], [], null],
        [current, ["vale"], [], "lamp"],
        [previous, ["vale"], ["vale"], null],
      ]) {
        const request = {
          op: "upgrade",
          ...seat,
          claimed,
          present,
          world,
          from,
          to: current,
          seed: seed === undefined ? undefined : 17,
        };
        const expected = pinned(request);
        assert.deepEqual(expected, {
          ok: true,
          world: { ...world, revision: world.revision + 1 },
        });
        assert.deepEqual(wasm(request), expected);
        const held = pinned({
          op: "hold",
          ...seat,
          world,
          choice: { item, revision: world.revision },
        });
        assert.equal(held.ok, true);
        world = held.world;
      }
    }
  }
});

test("opening upgrade defers saves that need additional migration", async () => {
  const { pinned, wasm } = await reducers();
  const [previous, current] = await versions();
  const { world } = pinned({ op: "create", history: true });
  const request = {
    op: "upgrade",
    ...seat,
    world,
    from: previous,
    to: current,
  };
  const seeded = { ...request, seed: 4242 };
  assert.equal(pinned(seeded).world.run.seed, 4242);
  const altered = structuredClone(world);
  altered.actors.mara.trust.vale = 1;
  for (const changes of [
    { seed: 4242 },
    { from: "full-card-world/2" },
    { from: current, to: previous },
    { claimed: ["vale", "mara"] },
    { claimed: [], present: ["vale"] },
    { world: altered },
  ]) {
    assert.equal(wasm({ ...request, ...changes }), null);
  }
});
