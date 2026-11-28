import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seat = { actor: "vale", claimed: ["vale"], present: ["vale"] };
function success(pinned, request) {
  const result = pinned(request);
  assert.equal(result.ok, true, result.error);
  return result.world;
}

function play(pinned, world, kind) {
  return success(pinned, {
    ...seat,
    world,
    op: "play",
    action: `${kind}:vale::`,
  });
}

function reflection(world, turn, rest = null) {
  return {
    ...seat,
    op: "reflect",
    world,
    turn,
    resting: "vale",
    rest,
    entries: [
      {
        id: "vale",
        reflection: {
          thought: `The room is quiet at turn ${turn}.`,
          persona: "A patient keeper.",
          evidence: world.memories.vale.events
            .filter((event) => event.kind === "event" && event.turn <= turn)
            .slice(-4)
            .map(({ seq }) => seq),
        },
      },
    ],
  };
}

test("late opening reflections keep the scene turn, ordered evidence, and bounded history", async () => {
  const { pinned, wasm } = await reducers();
  let world = success(pinned, { ...seat, op: "create", seed: 19 });
  for (let turn = 1; turn <= 26; turn++) {
    world = play(pinned, world, "wait");
    if (turn % 6 !== 2) continue;
    const request = reflection(world, turn - 1);
    request.entries[0].reflection.models = {
      thought: "thought-v1",
      persona: "persona-v2",
    };
    if (turn === 2) {
      const missing = structuredClone(request);
      missing.entries[0].reflection.evidence.push(world.eventSeq + 1);
      const refusal = pinned(missing);
      assert.equal(refusal.ok, false);
      assert.deepEqual(wasm(missing), refusal);
    }
    const result = wasm({ ...request, present: [] });
    assert.deepEqual(result, pinned({ ...request, present: [] }));
    assert.equal(
      result.world.memories.vale.innerLife.thoughts.at(-1).turn,
      turn - 1,
    );
    assert.equal(result.world.turn, turn);
    const duplicate = { ...request, world: result.world };
    assert.equal(pinned(duplicate).ok, false);
    assert.deepEqual(wasm(duplicate), pinned(duplicate));
    world = result.world;
  }
  assert.deepEqual(
    world.memories.vale.innerLife.thoughts.map(({ turn }) => turn),
    [7, 13, 19, 25],
  );
  assert.equal(world.memories.vale.reflections.length, 4);
});

test("long opening rest uses the recorded wake and refuses a dream it did not have", async () => {
  const { pinned, wasm } = await reducers();
  let world = success(pinned, { ...seat, op: "create", seed: 19 });
  world = play(pinned, world, "wait");
  for (let step = 0; step < 23; step++) world = play(pinned, world, "sleep");
  const wake = world.log.findLast(
    (event) => event.actorId === "vale" && event.woke,
  );
  assert.equal(wake.rest, "long");
  const request = reflection(world, wake.turn, "long");
  const expected = pinned(request);
  assert.equal(expected.ok, true, expected.error);
  assert.deepEqual(wasm(request), expected);

  request.entries[0].reflection.dream = "A lamp in the dark.";
  const denied = pinned(request);
  assert.equal(denied.ok, false);
  assert.deepEqual(wasm(request), denied);
  const witnessed = structuredClone(world);
  witnessed.log.findLast(
    (event) => event.actorId === "vale" && event.woke,
  ).dream = "glimpse";
  const dreamed = pinned({ ...request, world: witnessed });
  assert.equal(dreamed.ok, true, dreamed.error);
  assert.deepEqual(wasm({ ...request, world: witnessed }), dreamed);
  const unsupported = structuredClone(world);
  unsupported.opening.crossed = true;
  assert.equal(wasm({ ...request, world: unsupported }), null);
});
