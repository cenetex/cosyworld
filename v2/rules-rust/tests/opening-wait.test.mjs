import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "wait:vale::";

test("the first player wait records the pinned attic event and its witness memory", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    for (const stowed of [false, true]) {
      let { world } = pinned({ op: "create", ...options });
      if (stowed) {
        world = pinned({
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      const action = stowed ? { key, sleep: true } : key;
      const play = { ...seats, world, action, revision: world.revision };
      const result = pinned({ ...play, op: "play" });
      assert.equal(result.ok, true, result.error);
      const event = result.events[0];
      assert.equal(event.actorId, "vale");
      assert.equal(event.verb, "wait");
      assert.equal(event.light, !stowed);
      assert.ok(result.events.length > 1);
      const memories = Object.fromEntries(
        ["attic", "lamp", "vale"].map((id) => [id, result.world.memories[id]]),
      );
      assert.deepEqual(wasm({ ...play, op: "opening_wait_step" }), {
        ok: true,
        event,
        turn: result.world.turn,
        revision: result.world.revision,
        eventSeq: event.seq,
        log: result.world.log.filter((entry) => entry.seq <= event.seq),
        memories,
      }, JSON.stringify({ options, stowed }));
      if (options.hidden) assert.deepEqual(wasm({ ...play, op: "play" }), result);
    }
  }
});

test("the attic wait step declines stale requests and authored wait signs", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  const request = { ...seats, world, action: key, op: "opening_wait_step" };
  for (const changes of [
    { revision: -1 }, { present: [] }, { selectedIds: [] },
    { action: { kind: "pack", key } }, { action: "sleep:vale::" },
  ]) {
    assert.equal(wasm({ ...request, ...changes }), null);
  }
  const edited = JSON.parse(await readFile(new URL(
    "../../orchestrator-rust/src/card_shared/content.json", import.meta.url,
  ), "utf8"));
  const packs = edited.files["v2/card-game/packs.json"].packs;
  (packs[0].choices ??= []).push({ at: "attic", on: "wait" });
  assert.equal(wasm(request, JSON.stringify(edited)), null);
});
