import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const legacy = "This save needs a fresh start.";
const incomplete =
  "This save needs a fresh start. Your previous save is kept until you choose New game.";
const fuelError = "Invalid saved lamp room fuel.";

function stableValidation(reply) {
  if (reply?.ok !== false || typeof reply.error !== "string") return reply;
  const { error } = reply;
  for (const [primary, first] of [
    [legacy, "upgradeSave"],
    [incomplete, "validateWorld"],
  ]) {
    if (!error.startsWith(primary + " (") || !error.endsWith(")")) continue;
    const frames = error.slice(primary.length + 2, -1).split(" < ");
    const expected = [first, "decodeSave", "load", "dispatchShared"];
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

test("current saves requiring complete validation stay outside the refusal slice", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create", seed: 4242, history: true });
  const request = {
    op: "validate",
    world,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  };
  assert.equal(pinned(request).ok, true);
  assert.equal(wasm(request), null);
});
