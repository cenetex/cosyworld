import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const drop = "drop:vale:lamp:attic";
const take = "take:vale:lamp:";
const memories = ["vale", "attic", "lamp"];

test("taking the grounded attic lamp matches pinned custody and evidence", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 4242]) {
    for (const mode of ["held", "stowed", "dry"]) {
      const created = pinned({ op: "create", seed });
      assert.equal(created.ok, true, created.error);
      let { world } = created;
      if (mode === "stowed") {
        const held = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(held.ok, true, held.error);
        world = held.world;
      }
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        world.items.lamp.history = Array.from(
          { length: 12 },
          (_, i) => `Turn 0: Earlier lamp record ${i + 1}.`,
        );
      }
      const ground = { ...seats, world, op: "play", action: drop };
      const grounded = pinned(ground);
      assert.equal(grounded.ok, true, grounded.error);
      const saved = wasm(ground);
      assert.equal(
        isDeepStrictEqual(saved, grounded),
        true,
        `Drop ${seed} ${mode}`,
      );
      assert.equal(saved.world.items.lamp.holder, "attic");
      assert.equal(saved.world.actors.vale.heldItem, null);
      assert.ok(saved.actions.some(({ key }) => key === take));

      const request = {
        ...seats,
        world: saved.world,
        action: mode === "stowed" ? { key: take } : take,
        revision: saved.world.revision,
      };
      const expected = pinned({ ...request, op: "play" });
      assert.equal(expected.ok, true, expected.error);
      const actual = wasm({ ...request, op: "opening_take_step" });
      assert.ok(actual, `Take ${seed} ${mode}`);
      assert.deepEqual(actual, {
        ok: true,
        turn: expected.world.turn,
        revision: expected.world.revision,
        event: expected.events[0],
        lamp: expected.world.items.lamp,
        heldItem: expected.world.actors.vale.heldItem,
        memories: Object.fromEntries(
          memories.map((id) => [id, expected.world.memories[id]]),
        ),
      });
      assert.equal(actual.event.verb, "take");
      assert.equal(actual.event.light, mode !== "dry");
      assert.equal(actual.lamp.holder, "vale");
      assert.equal(actual.heldItem, "lamp");
      assert.equal(actual.memories.vale.subjects.lamp.deeds[0].verb, "take");
      assert.equal(actual.memories.vale.subjects.lamp.sight.holder, "vale");
    }
  }
});

test("the attic lamp Take stage requires the first completed Drop and no hold choice", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  const grounded = pinned({ ...seats, world, op: "play", action: drop }).world;
  const request = {
    ...seats,
    world: grounded,
    op: "opening_take_step",
    action: take,
  };
  for (const change of [
    { world },
    { revision: 0 },
    { selectedIds: [] },
    { action: "take:vale:cloth:" },
  ]) {
    assert.equal(wasm({ ...request, ...change }), null);
  }
  assert.equal(wasm({ ...request, op: "play" }), null);
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
    id: "attic-lamp-hold",
    on: "hold",
    subject: "lamp",
    at: "attic",
  });
  assert.equal(wasm(request, JSON.stringify(content)), null);
});
