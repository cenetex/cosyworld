import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const visitors = new Set(["mara", "ash", "nell", "tavi", "rue", "orin", "ada"]);

function afterPlayer(pinned, options, order, claimed, present) {
  const { world } = pinned({ op: "create", ...options });
  const entries = Object.entries(world.actors);
  if (order === "reverse") world.actors = Object.fromEntries(entries.reverse());
  if (order === "sorted") world.actors = Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : 1));
  const seats = { actor: "vale", claimed, present };
  const result = pinned({ ...seats, op: "play", world, action: "wait:vale::" });
  assert.equal(result.ok, true, result.error);

  const first = result.events.findIndex((event) => event.verb === "take");
  const prefix = first < 0 ? result.events.slice(0, 1) : result.events.slice(0, first);
  const phase = {
    ...world, turn: result.world.turn, revision: result.world.revision,
    eventSeq: prefix.at(-1).seq, log: [...world.log, ...prefix],
  };
  const residents = Object.keys(world.actors).filter((actor) => visitors.has(actor));
  return {
    request: { ...seats, world: phase, residents, op: "opening_pickups" },
    result,
  };
}

test("resident visitors take belongings in the pinned opening order", async () => {
  const { pinned, wasm } = await reducers();
  for (const { options, order, claimed = ["vale"], present = ["vale"], count } of [
    { options: {}, order: "authored", count: 7 },
    { options: { history: true }, order: "authored", count: 7 },
    { options: { seed: 4242, history: true }, order: "reverse", count: 7 },
    { options: { seed: 17 }, order: "sorted", claimed: ["vale", "mara", "ada"], present: ["vale", "mara"], count: 6 },
    { options: { seed: 17, history: true, hidden: "mara", absent: ["ash"], homecoming: "rue" }, order: "authored", count: 4 },
    { options: { absent: [...visitors] }, order: "authored", count: 0 },
  ]) {
    const { request, result } = afterPlayer(pinned, options, order, claimed, present);
    const events = result.events.filter(({ verb, actorId }) => verb === "take" && visitors.has(actorId));
    assert.equal(events.length, count);
    const actors = {}, items = {}, memories = {};
    for (const { actorId, itemId, locationId } of events) {
      const after = result.world.actors[actorId];
      assert.equal(after.heldItem, itemId);
      actors[actorId] = { ...after };
      for (const field of ["slept", "sleeping"]) {
        if (Object.hasOwn(request.world.actors[actorId], field)) {
          actors[actorId][field] = request.world.actors[actorId][field];
        } else {
          delete actors[actorId][field];
        }
      }
      items[itemId] = result.world.items[itemId];
      for (const id of [actorId, itemId, locationId]) memories[id] = result.world.memories[id];
    }
    assert.deepEqual(wasm(request), {
      ok: true, eventSeq: events.at(-1)?.seq ?? request.world.eventSeq,
      events, actors, items, memories,
    }, JSON.stringify({ options, order, claimed, present }));
  }
});

test("the pickup phase declines repeated residents and an uncommitted Wait", async () => {
  const { pinned, wasm } = await reducers();
  const { request } = afterPlayer(pinned, {}, "authored", ["vale"], ["vale"]);
  assert.equal(wasm({ ...request, residents: ["mara", "mara"] }), null);
  const { world } = pinned({ op: "create" });
  assert.equal(wasm({ ...request, world }), null);
});
