import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const play = { ...seats, action: "wait:vale::" };
const ship = "greek-scylla";
const from = "greek-pagasae";
const to = "greek-lemnos";

function check({ pinned, wasm }, world, request = play, voyages = []) {
  const reference = pinned({ ...request, world, op: "play" });
  assert.equal(reference.ok, true, reference.error);
  const signals = Object.fromEntries(Object.entries(reference.world.crossings)
    .filter(([, state]) => Number.isInteger(state.phase)));
  assert.deepEqual(wasm({ ...request, world, op: "opening_wait_settlement" }), {
    ok: true,
    ringing: reference.world.items.bell.ringing,
    transports: reference.world.transports,
    signals,
    voyages,
  });
  return reference;
}

test("the pinned first attic Wait decays old bells and leaves docked ships and stock alone", async () => {
  const engines = await reducers();
  for (const options of [{}, { seed: 4242 }, { seed: 17, history: true }]) {
    const { world } = engines.pinned({ op: "create", ...options });
    for (const duration of [0, 1, 2, 3]) {
      world.items.bell.ringing = duration;
      const result = check(engines, world);
      assert.equal(result.world.items.bell.ringing, Math.max(0, duration - 1));
      assert.deepEqual(result.world.usedUp, world.usedUp);
    }
  }
});

test("the pinned first attic Wait docks an empty ship and follows its recall", async () => {
  const engines = await reducers();
  const { world } = engines.pinned({ op: "create", seed: 4242 });
  Object.assign(world.transports[ship], { phase: "arrived", riders: ["mara"] });
  const previouslyArrived = check(engines, world);
  assert.equal(previouslyArrived.world.transports[ship].phase, "docked");
  assert.deepEqual(previouslyArrived.world.transports[ship].riders, []);

  for (const [recall, dock, name] of [
    [null, to, "The Lemnian Cave"],
    [from, from, "Pagasae Anchorage"],
  ]) {
    Object.assign(world.transports[ship], { phase: "sea", riders: [], destination: to, recall });
    const result = check(engines, world, play, [{ id: ship, kind: "arrive", from, dock, riders: [] }]);
    const arrival = result.events.find((event) => event.locationId === ship);
    assert.equal(arrival?.text, `The Scylla docks at ${name}.`);
    assert.equal(result.world.transports[ship].since, world.turn + 1);
    assert.equal(result.world.transports[ship].recall, null);
  }
});

test("the pinned first attic Wait breaks another seated player's unfinished pond signal", async () => {
  const engines = await reducers();
  const { world } = engines.pinned({ op: "create", seed: 4242 });
  world.actors.mara.place = "pond";
  world.crossings["pond-clearing"].phase = 1;
  const shared = { ...play, claimed: ["vale", "mara"], present: ["vale", "mara"] };
  const reference = check(engines, world, shared);
  assert.equal(reference.world.crossings["pond-clearing"].phase, 0);
});

test("attic settlement declines a light change or a ship with someone aboard", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  const request = { ...play, op: "opening_wait_settlement" };
  const dusk = { ...world, turn: 23, began: 23, revision: 23 };
  assert.equal(wasm({ ...request, world: dusk }), null);
  const occupied = world.transports["greek-ship"];
  Object.assign(occupied, { phase: "sea", destination: "pond" });
  assert.equal(wasm({ ...request, world }), null);
});
