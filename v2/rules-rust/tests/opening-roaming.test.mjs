import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const bard = "greek-rhapsode";
const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function compare(pinned, wasm, world) {
  const request = { ...seats, world, action: "wait:vale::" };
  const expected = pinned({ ...request, op: "play" });
  assert.equal(expected.ok, true, expected.error);
  const event = expected.events.find((entry) => entry.actorId === bard);
  assert.equal(event?.verb, "move");
  const fields = [
    "actorId",
    "fromLocationId",
    "itemId",
    "kind",
    "locationId",
    "speaker",
    "targetId",
    "text",
    "verb",
  ];
  const result = wasm({ ...request, op: "opening_bard_move" });
  assert.deepEqual(result, {
    ok: true,
    actor: expected.world.actors[bard],
    routes: expected.world.routeKnowledge[bard],
    event: Object.fromEntries(fields.map((field) => [field, event[field]])),
  });
  return result;
}

test("a first attic wait moves the bard along the pinned route", async () => {
  const { pinned, wasm } = await reducers();
  for (const options of [
    {},
    { seed: 4242 },
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    const world = pinned({ ...options, op: "create" }).world;
    compare(pinned, wasm, world);
  }
});

test("the bard learns visible roads and changes direction for a different want", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({ op: "create", seed: 4242 }).world;
  const removed = new Set([
    "greek-harbor>greek-road-thebes",
    "greek-road-thebes>greek-harbor",
  ]);
  world.routeKnowledge[bard] = world.routeKnowledge[bard].filter(
    (edge) => !removed.has(edge.join(">")),
  );
  const learned = compare(pinned, wasm, world);
  assert.equal(learned.routes.length, world.routeKnowledge[bard].length + 2);

  world.actors[bard].want.target =
    "greek-story-aeschylus-suppliant-women-first";
  assert.equal(compare(pinned, wasm, world).actor.place, "greek-argolid-road");

  world.actors[bard].dwellUntil = 2;
  const wait = { ...seats, world, action: "wait:vale::" };
  assert.equal(
    pinned({ ...wait, op: "play" }).world.actors[bard].place,
    "greek-harbor",
  );
  assert.equal(wasm({ ...wait, op: "opening_bard_move" }), null);
});
