import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const legacy = "This save needs a fresh start.";
const incomplete =
  "This save needs a fresh start. Your previous save is kept until you choose New game.";
const fuelError = "Invalid saved lamp room fuel.";

function stableValidation(reply, caller = "load") {
  if (reply?.ok !== false || typeof reply.error !== "string") return reply;
  const { error } = reply;
  for (const [primary, first] of [
    [legacy, "upgradeSave"],
    [incomplete, "validateWorld"],
  ]) {
    if (!error.startsWith(primary + " (") || !error.endsWith(")")) continue;
    const frames = error.slice(primary.length + 2, -1).split(" < ");
    const expected = [first, "decodeSave", caller, "dispatchShared"];
    if (frames.length !== expected.length) continue;
    if (
      frames.every((frame, index) => {
        const [name, line, extra] = frame.split(":");
        return (
          extra === undefined &&
          name === expected[index] &&
          /^\d+$/u.test(line) &&
          Number(line) > 0 &&
          Number(line) <= 0xffffffff
        );
      })
    )
      return { ...reply, error: primary };
  }
  return reply;
}

test("definite validate refusals match pinned JavaScript", async () => {
  const { pinned, wasm } = await reducers();
  const lamp = {
    lit: true,
    fuelRooms: 3,
    fuelPlace: "attic",
    fuelVisit: true,
    fuel: 12,
  };
  const withLamp = (changes) => ({
    schema: 7,
    items: { lamp: { ...lamp, ...changes } },
  });
  for (const [input, error] of [
    [{}, "Load a saved world first."],
    [{ world: "old save" }, "Load a saved world first."],
    [{ world: null }, "Load a saved world first."],
    [{ world: [] }, legacy],
    [{ world: { schema: 1 } }, legacy],
    [{ world: { schema: 6 } }, legacy],
    [{ world: { schema: 7 } }, legacy],
    [{ world: { schema: "8" } }, legacy],
    [{ world: { schema: 9 } }, legacy],
    [{ world: { schema: 8 } }, incomplete],
    [{ world: { schema: 8, turn: 0, revision: 0 } }, incomplete],
    [{ world: { schema: 7 }, actor: "keeper" }, "Choose a human avatar."],
    [{ world: { schema: 7 }, actor: 0 }, legacy],
    [
      { world: { schema: 7 }, claimed: ["vale", "vale"] },
      "Choose valid human avatars.",
    ],
    [{ world: { schema: 7 }, present: null }, "Choose valid human avatars."],
    [
      {
        world: {
          schema: 7,
          controlledActors: ["mara"],
          presentActors: ["vale"],
        },
      },
      "A present avatar needs a claim.",
    ],
    [{ world: { schema: 7, controlledActors: false } }, legacy],
    [{ world: withLamp({ lit: 1 }) }, fuelError],
    [{ world: withLamp({ fuelRooms: 4 }) }, fuelError],
    [{ world: withLamp({ fuelPlace: "unwritten-room" }) }, fuelError],
    [{ world: withLamp({ fuelVisit: "yes" }) }, fuelError],
    [{ world: withLamp({ fuel: 8 }) }, fuelError],
    ...["attic", "greek-gate", "theatre", "boardyai-parlour"].map(
      (fuelPlace) => [{ world: withLamp({ fuelPlace }) }, legacy],
    ),
  ]) {
    const request = { op: "validate", ...input };
    const actual = wasm(request);
    const expected = { ok: false, error };
    assert.deepEqual(stableValidation(actual), expected, JSON.stringify(input));
    assert.deepEqual(
      stableValidation(pinned(request)),
      expected,
      JSON.stringify(input),
    );
  }
});

const seat = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function hold(pinned, world, item) {
  const result = pinned({
    op: "hold",
    world,
    ...seat,
    choice: { item, revision: world.revision },
  });
  assert.equal(result.ok, true);
  return result.world;
}

test("unseeded opening saves validate after exact reconstruction and quiet holds", async () => {
  const { pinned, wasm } = await reducers();
  for (const history of [false, true]) {
    const fresh = pinned({ op: "create", history });
    assert.equal(fresh.ok, true);
    const initial = fresh.world;
    const compare = (world) => {
      const request = { op: "validate", world, ...seat };
      const expected = pinned(request);
      assert.equal(expected.ok, true);
      assert.deepEqual(
        wasm(request),
        expected,
        `history ${history} revision ${world.revision} held ${world.actors.vale.heldItem}`,
      );
    };
    compare(initial);
    for (const item of [null, "lamp"]) {
      const once = hold(pinned, initial, item);
      compare(once);
      compare(hold(pinned, once, "lamp"));
    }
  }
});

test("validation leaves changes outside the reconstructed save unsupported", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create", history: true });
  for (const mutate of [
    (save) => (save.actors.mara.place = "unknown-room"),
    (save) => (save.items.cloth.holder = "unavailable-holder"),
    (save) => (save.memories.vale.events = "not events"),
    (save) => (save.knowledge.facts = []),
    (save) => (save.log[0].text = "Different remembered wording."),
    (save) => (save.usedUp = ["a-missing-item"]),
    (save) => (save.run = { seed: 17 }),
  ]) {
    const altered = structuredClone(world);
    mutate(altered);
    assert.equal(wasm({ op: "validate", world: altered, ...seat }), null);
  }
  const later = [null, "lamp", null].reduce(
    (save, item) => hold(pinned, save, item),
    world,
  );
  const late = { op: "validate", world: later, ...seat };
  assert.equal(pinned(late).ok, true);
  assert.equal(wasm(late), null);
  const other = { op: "validate", world, actor: "mara", claimed: ["mara"] };
  assert.equal(pinned(other).ok, true);
  assert.equal(wasm(other), null);
});

test("opening validation uses a saved u32 seed for exact reconstruction", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 4242, 0xffffffff]) {
    for (const history of [false, true]) {
      const { world } = pinned({ op: "create", seed, history });
      for (const saved of [world, hold(pinned, world, null)]) {
        assert.equal(saved.run.seed, seed);
        const request = { op: "validate", world: saved, ...seat };
        const expected = pinned(request);
        assert.equal(expected.ok, true);
        assert.deepEqual(
          wasm(request),
          expected,
          `seed ${seed}, history ${history}`,
        );
      }
    }
  }
  const { world } = pinned({ op: "create", seed: 4242, history: true });
  world.run = { seed: 0x100000000 };
  assert.equal(wasm({ op: "validate", world, ...seat }), null);
});

test("import preflight refuses definite shape and save header failures", async () => {
  const { pinned, wasm } = await reducers();
  const choose = "Choose a saved world.";
  for (const [save, error] of [
    ...[false, true, 1, [], "[]", '"hello"', "false", "null"].map((save) => [
      save,
      choose,
    ]),
    ["{}", legacy],
    [{ schema: 7, claimed: ["mara"], present: ["mara"] }, legacy],
    [
      {
        schema: 8,
        turn: 0,
        revision: 0,
        playerActorId: "keeper",
        sharedMigration: { spoofed: true },
      },
      incomplete,
    ],
    [{ schema: 7, items: { lamp: { fuelRooms: 4, lit: true } } }, fuelError],
  ]) {
    const request = { op: "create", save, seed: 4321 };
    const expected = { ok: false, error };
    assert.deepEqual(wasm(request), expected, JSON.stringify(save));
    assert.deepEqual(
      stableValidation(pinned(request), "importClientSave"),
      expected,
      JSON.stringify(save),
    );
  }

  const { world } = pinned({ op: "create", seed: 4242, history: true });
  const request = { op: "create", save: JSON.stringify(world), seed: 4321 };
  assert.equal(pinned(request).ok, true);
  assert.equal(wasm(request), null);
  assert.equal(wasm({ ...request, save: "not-json" }), null);
});
