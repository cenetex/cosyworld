import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "drop:vale:lamp:attic";
const cast = ["vale", "attic", "lamp"];

test("first attic lamp drops match pinned custody, light and event evidence", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    const creation = pinned({ ...options, op: "create" });
    assert.equal(creation.ok, true, creation.error);
    for (const stowed of [false, true]) {
      let { world } = creation;
      if (stowed) {
        const held = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(held.ok, true, held.error);
        world = held.world;
      }
      const request = { ...seats, world, action, revision: world.revision };
      const expected = pinned({ ...request, op: "play" });
      assert.equal(expected.ok, true, expected.error);
      const drop = wasm({ ...request, op: "opening_drop_step" });
      const event = expected.events[0];
      assert.ok(drop, JSON.stringify({ options, stowed }));
      assert.deepEqual(drop.event, event);
      assert.equal(event.verb, "drop");
      assert.equal(event.light, true);
      assert.deepEqual(drop.lamp, expected.world.items.lamp);
      assert.equal(drop.heldItem, expected.world.actors.vale.heldItem);
      assert.equal(drop.turn, expected.world.turn);
      assert.equal(drop.revision, expected.world.revision);
      for (const id of cast) {
        if (!stowed) {
          assert.deepEqual(drop.memories[id], expected.world.memories[id]);
          continue;
        }
        const newMoment = (memory) =>
          memory.events.find(({ seq }) => seq === event.seq);
        assert.deepEqual(
          newMoment(drop.memories[id]),
          newMoment(expected.world.memories[id]),
        );
      }
      assert.equal(drop.memories.vale.subjects.lamp.deeds[0].verb, "drop");
      assert.equal(drop.memories.vale.subjects.lamp.sight.holder, "attic");
    }
  }
});

test("first attic lamp drop declines stale input, changed custody and authored meetings", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  const request = { ...seats, world, action, op: "opening_drop_step" };
  for (const change of [
    { revision: -1 },
    { present: [] },
    { selectedIds: [] },
    { action: "drop:vale:lamp:pond" },
  ]) {
    assert.equal(wasm({ ...request, ...change }), null);
  }
  const dropped = pinned({ ...request, op: "play" }).world;
  assert.equal(wasm({ ...request, world: dropped }), null);
  const content = JSON.parse(
    await readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const pack = content.files["v2/card-game/packs.json"].packs[0];
  (pack.choices ??= []).push({
    id: "attic-meeting",
    on: "meet",
    at: "attic",
    subject: "lamp",
  });
  assert.equal(wasm(request, JSON.stringify(content)), null);
});

test("a dry lamp stays dark when grounded and keeps only twelve custody notes", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
  world.items.lamp.history = Array.from(
    { length: 12 },
    (_, i) => `Turn 0: Earlier lamp record ${i + 1}.`,
  );
  const request = { ...seats, world, action };
  const expected = pinned({ ...request, op: "play" });
  assert.equal(expected.ok, true, expected.error);
  const drop = wasm({ ...request, op: "opening_drop_step" });
  assert.deepEqual(drop.event, expected.events[0]);
  assert.equal(drop.event.light, false);
  assert.deepEqual(drop.lamp, expected.world.items.lamp);
  assert.equal(drop.lamp.history.length, 12);
});
