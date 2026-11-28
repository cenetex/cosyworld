import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const key = "wait:vale::";

function compare({ pinned, wasm }, world) {
  const request = { ...seats, world, action: key, revision: world.revision };
  const reference = pinned({ ...request, op: "play" });
  assert.equal(reference.ok, true, reference.error);
  assert.deepEqual(wasm({ ...request, op: "opening_attic_rest" }), {
    ok: true,
    vale: reference.world.actors.vale,
    defeats: reference.world.defeats ?? null,
  });
  return reference.world;
}

test("the first solo attic Wait restores Vale's sanctuary, visit and losses", async () => {
  const engines = await reducers();
  for (const options of [{}, { seed: 4242 }, { seed: 17, history: true }]) {
    const { world } = engines.pinned({ op: "create", ...options });
    const vale = world.actors.vale;
    delete vale.sanctuary;
    vale.visited = [];
    vale.guarding = "pond";
    world.defeats = options.history ? { vale: 1 } : { vale: 2, mara: 1 };
    const next = compare(engines, world);
    assert.equal(next.actors.vale.sanctuary, "attic");
    assert.deepEqual(next.actors.vale.visited, ["attic"]);
    assert.ok(!Object.hasOwn(next.actors.vale, "guarding"));
    assert.deepEqual(next.defeats, options.history ? {} : { mara: 1 });
  }
});

test("the first solo attic Wait preserves a current speech visit and starts a new one", async () => {
  const engines = await reducers();
  for (const [saved, firstTurn] of [
    [undefined, 1],
    [{ place: "attic", turn: 0 }, 0],
    [{ place: "attic", turn: null }, 1],
    [{ place: "pond", turn: 0 }, 1],
  ]) {
    const { world } = engines.pinned({ op: "create" });
    if (saved) world.actors.vale.waitSpeech = saved;
    const next = compare(engines, world);
    assert.deepEqual(next.actors.vale.waitSpeech, { place: "attic", turn: firstTurn });
  }
});

test("the quiet attic step preserves an unmet want and declines quest completion", async () => {
  const engines = await reducers();
  const { pinned, wasm } = engines;
  const { world } = pinned({ op: "create" });
  const { world: accepted } = pinned({
    ...seats, world, op: "play", action: "accept:vale::box:pond",
  });
  const quest = accepted.actors.vale.want;
  assert.equal(quest.target, "lamp");
  assert.deepEqual(compare(engines, accepted).actors.vale.want, quest);

  const { world: stowed } = pinned({
    ...seats, world, op: "hold", choice: { item: null, revision: world.revision },
  });
  stowed.actors.vale.want = quest;
  delete stowed.actors.vale.content;
  const request = { ...seats, world: stowed, action: key };
  const reference = pinned({ ...request, op: "play" });
  assert.equal(reference.ok, true, reference.error);
  assert.equal(reference.world.actors.vale.want, null);
  assert.ok(reference.events.some((event) => event.verb === "want_met"));
  assert.equal(wasm({ ...request, op: "opening_attic_rest" }), null);
});
