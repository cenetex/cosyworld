import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberEvent } from "../../card-game/memory.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const action = "drop:vale:lamp:attic";
const closes = "The attic mirror's path to the pond closes.";
const observed = ["vale", "attic", "lamp"];

function beforeReflection(world, result, narration) {
  const after = structuredClone(result.world);
  if (!narration) return after;
  assert.deepEqual(narration, result.events.at(-1));
  after.eventSeq = narration.seq - 1;
  after.log = after.log.filter((event) => event.seq !== narration.seq);
  const prior = structuredClone(world);
  for (const event of result.events.slice(0, -1)) rememberEvent(prior, event);
  for (const id of observed) after.memories[id] = prior.memories[id];
  return after;
}

test("grounding the attic lamp matches pinned reflection, crossing and actions", async () => {
  const { pinned, wasm } = await reducers();
  for (const setup of [
    {},
    { seed: 4242, history: true },
    { seed: 17, history: true, hidden: "mara", absent: ["ash"] },
  ]) {
    for (const mode of ["held", "stowed", "dry", "accepted"]) {
      let { world } = pinned({ ...setup, op: "create" });
      if (mode === "stowed")
        world = pinned({
          ...seats,
          world,
          op: "hold",
          choice: { item: null, revision: world.revision },
        }).world;
      if (mode === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      if (mode === "accepted")
        world = pinned({
          ...seats,
          world,
          op: "play",
          action: "accept:vale::box:pond",
        }).world;
      const request = { ...seats, world, action };
      const expected = pinned({ ...request, op: "play" });
      assert.equal(expected.ok, true, expected.error);
      assert.deepEqual(expected.world.crossings, world.crossings);
      const narration = expected.events.find((event) => event.text === closes);
      assert.equal(Boolean(narration), mode === "stowed");
      const afterDrop = beforeReflection(world, expected, narration);
      const actual = wasm({
        ...request,
        afterDrop,
        op: "opening_drop_reflection",
      });
      assert.deepEqual(
        actual,
        {
          ok: true,
          narration: narration ?? null,
          eventSeq: expected.world.eventSeq,
          log: expected.world.log,
          exits: expected.exits,
          actions: expected.actions,
          crossings: world.crossings,
          memories: Object.fromEntries(
            observed.map((id) => [id, expected.world.memories[id]]),
          ),
        },
        JSON.stringify({ setup, mode }),
      );
    }
  }
});

test("reflection settlement declines changed crossing locks or a narration already recorded", async () => {
  const { pinned, wasm } = await reducers();
  const creation = pinned({ op: "create" });
  const { world } = pinned({
    ...seats,
    world: creation.world,
    op: "hold",
    choice: { item: null, revision: creation.world.revision },
  });
  const request = { ...seats, world, action };
  const expected = pinned({ ...request, op: "play" });
  assert.equal(
    wasm({
      ...request,
      afterDrop: expected.world,
      op: "opening_drop_reflection",
    }),
    null,
  );
  const afterDrop = beforeReflection(world, expected, expected.events.at(-1));
  afterDrop.crossings["pond-greek-harbor"].discovered = true;
  assert.equal(
    wasm({ ...request, afterDrop, op: "opening_drop_reflection" }),
    null,
  );
});
