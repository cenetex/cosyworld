import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

async function source() {
  const content = JSON.parse(
    await readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const forest = content.files["v2/card-game/forest.json"];
  const world = structuredClone(forest.initialState);
  for (const kind of ["actors", "items"]) {
    for (const [id, fields] of Object.entries(forest.opening[kind])) {
      Object.assign(world[kind][id], fields);
    }
  }
  return { content, world };
}

function residentState(actor) {
  const { place, crossed, lastTalk, trust, awake, irritation, wakeCause } =
    actor;
  return { place, crossed, lastTalk, trust, awake, irritation, wakeCause };
}

test("fresh authored mounts match the pinned unseeded opening", async () => {
  const { pinned, wasm } = await reducers();
  const { content, world } = await source();
  const reference = pinned({ op: "create" });
  const candidate = wasm({ op: "mount_packs", world });
  assert.equal(reference.ok, true);
  assert.equal(candidate?.ok, true);
  const actual = candidate.world;
  const expected = reference.world;
  for (const field of ["packs", "crossings", "transports", "peaceUntil"]) {
    assert.deepEqual(actual[field], expected[field], field);
  }
  assert.deepEqual(
    Object.keys(actual.actors).sort(),
    Object.keys(expected.actors).sort(),
  );
  for (const [id, actor] of Object.entries(expected.actors)) {
    assert.deepEqual(
      residentState(actual.actors[id]),
      residentState(actor),
      id,
    );
  }
  assert.deepEqual(
    Object.keys(actual.items).sort(),
    Object.keys(expected.items).sort(),
  );
  const beforeSharedSettlement = new Map(
    content.files["v2/card-game/shared-cast.json"].avatars
      .filter(({ id }) => id !== "vale")
      .map(({ id, item }) => [item.id, id]),
  );
  const elysium = content.files["v2/card-game/packs.json"].packs.find(
    ({ id }) => id === "elysium",
  );
  beforeSharedSettlement.set(
    "elysium-wayfinder",
    elysium.items["elysium-wayfinder"].holder,
  );
  for (const [id, item] of Object.entries(expected.items)) {
    if (Object.hasOwn(world.items, id)) {
      assert.deepEqual(actual.items[id], world.items[id], id);
    } else {
      assert.deepEqual(
        actual.items[id],
        {
          history: item.history,
          holder: beforeSharedSettlement.get(id) ?? item.holder,
        },
        id,
      );
    }
  }
});

test("fresh mount declines mounted state and duplicate pack identities", async () => {
  const { wasm } = await reducers();
  const { world, content } = await source();
  const mounted = wasm({ op: "mount_packs", world }).world;
  assert.equal(wasm({ op: "mount_packs", world: mounted }), null);
  const packs = content.files["v2/card-game/packs.json"].packs;
  packs.push(packs[0]);
  assert.equal(
    wasm({ op: "mount_packs", world }, JSON.stringify(content)),
    null,
  );
});
