import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { load } from "../../card-game/shared-world.mjs";
import { plan } from "../../card-game/world.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const hub = ["moth", "keeper"];

test("Pip and the Keeper make silent Waits on the first solo turn", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [null, 0, 17, 4242, 4_294_967_295]) {
    for (const stowed of [false, true]) {
      let { world } = pinned({ op: "create", seed });
      if (stowed) {
        world = pinned({
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      const planning = load({ ...seats, world });
      planning.turn += 1;
      planning.revision += 1;
      const plans = hub.map((id) => plan(planning, id).action.key);
      assert.deepEqual(plans, ["wait:moth::", "wait:keeper::"]);
      const played = pinned({ ...seats, op: "play", world, action: "wait:vale::" });
      assert.equal(played.ok, true, played.error);
      const events = played.events.filter((event) => hub.includes(event.actorId));
      assert.deepEqual(events, []);
      const actors = {}, memories = {};
      for (const id of hub) {
        actors[id] = played.world.actors[id];
        memories[id] = played.world.memories[id];
        assert.deepEqual(actors[id], world.actors[id]);
        assert.deepEqual(memories[id], world.memories[id]);
      }
      for (const item of ["lamp", "cloth", "oil", "bell", "keeper-log"]) {
        assert.deepEqual(played.world.items[item], world.items[item]);
      }
      assert.deepEqual(wasm({ ...seats, world, op: "opening_hub_idle" }),
        { ok: true, plans, actors, memories, events });
    }
  }
});

test("historic hub residents wait or skip their turn, and solo Boardy stays absent", async () => {
  const { pinned, wasm } = await reducers();
  for (const fixture of [
    {}, { seed: 0 }, { seed: 17, hidden: "mara", absent: ["ash"] },
    { seed: 4242, scheduled: true }, { seed: 4_294_967_295, boardyAtStation: true },
  ]) {
    const { scheduled, boardyAtStation, ...options } = fixture;
    const created = pinned({ op: "create", history: true, ...options });
    assert.equal(created.ok, true, created.error);
    const { world } = created;
    if (scheduled) {
      world.actors.keeper.slept = world.turn - 11;
      world.actors.keeper.sleeping = {
        since: world.turn - 2, until: world.turn + 3, place: "station",
      };
    }
    if (boardyAtStation) world.actors.boardyai.place = "station";

    const planning = load({ ...seats, world });
    planning.turn += 1;
    planning.revision += 1;
    const plans = hub.map((id) =>
      planning.actors[id].sleeping?.until !== undefined ? null : plan(planning, id).action.key);
    assert.deepEqual(plans, ["wait:moth::", scheduled ? null : "wait:keeper::"]);
    const played = pinned({ ...seats, op: "play", world, action: "wait:vale::" });
    assert.equal(played.ok, true, played.error);
    const ids = [...hub, "boardyai"];
    assert.deepEqual(played.events.filter((event) => ids.includes(event.actorId)), []);
    const { boardyai: boardy } = played.world.actors;
    assert.deepEqual(boardy, {
      ...world.actors.boardyai,
      want: { ...world.actors.boardyai.want, since: played.world.turn },
    });
    assert.deepEqual(played.world.memories.boardyai, world.memories.boardyai);
    const actual = wasm({ ...seats, world, op: "opening_hub_idle" });
    assert.ok(actual, JSON.stringify(fixture));
    assert.deepEqual(actual.plans, plans);
    for (const id of hub) {
      const { sleeping, slept, ...actor } = played.world.actors[id];
      assert.deepEqual(actual.actors[id], world.actors[id], id);
      const { sleeping: beforeSleep, slept: beforeSlept, ...before } = actual.actors[id];
      assert.deepEqual(actor, before, id);
      assert.deepEqual(played.world.memories[id], actual.memories[id], id);
    }
    if (scheduled) {
      assert.deepEqual(played.world.actors.keeper.sleeping, world.actors.keeper.sleeping);
    }
    for (const id of ["lamp", "bell", "cloth", "oil", "boardyai-calling-card"]) {
      assert.deepEqual(played.world.items[id], world.items[id], id);
    }
  }
});

test("the hub phase declines a reachable attic or different resident plans", async () => {
  const { pinned, wasm } = await reducers();
  const request = { ...seats, world: pinned({ op: "create" }).world, op: "opening_hub_idle" };
  for (const change of [
    (world) => { world.items.bell.holder = "pond"; },
    (world) => { world.items["keeper-log"].holder = "keeper"; },
    (world) => { world.actors.keeper.want = null; },
    (world) => { world.routeKnowledge.moth = [["pond", "station"]]; },
  ]) {
    const world = structuredClone(request.world);
    change(world);
    assert.equal(wasm({ ...request, world }), null);
  }
  const content = JSON.parse(await readFile(new URL(
    "../../orchestrator-rust/src/card_shared/content.json", import.meta.url,
  ), "utf8"));
  const forest = content.files["v2/card-game/forest.json"];
  forest.places.pond.exits.push("attic");
  assert.equal(wasm(request, JSON.stringify(content)), null);
  forest.places.pond.exits.pop();
  content.files["v2/card-game/boardyai.json"].avatars.boardyai.requires = [];
  assert.equal(wasm(request, JSON.stringify(content)), null);
});
