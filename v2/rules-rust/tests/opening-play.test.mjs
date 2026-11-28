import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const content = await readFile(
  new URL(
    "../../orchestrator-rust/src/card_shared/content.json",
    import.meta.url,
  ),
  "utf8",
);
const acceptPond = "accept:vale::box:pond";

function opening(pinned, options) {
  const { world } = pinned({ op: "create", ...options });
  return pinned({ op: "join", ...seats, claimed: [], present: [], world })
    .world;
}

function compare(actual, expected, description) {
  if (isDeepStrictEqual(actual, expected)) return;
  const changed = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.fail(`${description} differs in ${changed ?? "response"}`);
}

test("Vale accepts the opening mirror quest with the pinned response", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 17, 4242, 4_294_967_295]) {
    for (const history of [false, true]) {
      let world = opening(pinned, { seed, history, hidden: "mara" });
      for (const item of [null, "lamp"]) {
        world = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item, revision: world.revision },
        }).world;
      }
      for (const action of [acceptPond, { key: acceptPond }]) {
        const request = { ...seats, op: "play", world, action };
        const actual = wasm(request);
        const expected = pinned(request);
        compare(
          actual,
          expected,
          `opening quest for seed ${seed}, history ${history}`,
        );
        assert.equal(actual.ok, true);
        assert.deepEqual(actual.events, []);
        assert.equal(actual.world.turn, world.turn);
        assert.equal(actual.world.revision, world.revision + 1);
        assert.equal(actual.world.actors.vale.want.from, "quest:box:pond");
        assert.equal(actual.world.actors.vale.want.lit, false);
      }
    }
  }
});

test("opening play refusals preserve the entire pinned world", async () => {
  const { pinned, wasm } = await reducers();
  const world = opening(pinned, { seed: 4242, history: true });
  const play = { ...seats, op: "play", world, action: acceptPond };
  for (const [changes, error] of [
    [{ present: [] }, "Enter this world with your avatar first."],
    [
      { revision: world.revision - 1 },
      "The world changed. Choose a current play.",
    ],
    [
      { action: null },
      "That play has changed. Check the cards and choose again.",
    ],
    [
      { action: "unknown-card" },
      "That play has changed. Check the cards and choose again.",
    ],
    [
      { action: "wait:vale" },
      "That play has changed. Check the cards and choose again.",
    ],
  ]) {
    const request = { ...play, ...changes };
    const actual = wasm(request);
    compare(actual, pinned(request), error);
    assert.equal(actual.ok, false);
    assert.equal(actual.error, error);
  }
  assert.equal(wasm(play, "{}"), null);
  const updated = JSON.parse(content);
  updated.files["v2/card-game/packs.json"].packs[0].crossings.push({
    from: "attic",
    to: "pond",
  });
  assert.equal(wasm(play, JSON.stringify(updated)), null);
  const wait = { ...play, action: "wait:vale::" };
  compare(wasm(wait), pinned(wait), "historic opening Wait");
  assert.equal(
    wasm({ ...wait, claimed: ["vale", "mara"], present: ["vale", "mara"] }),
    null,
  );
});

test("accepting the opening quest with another seat present matches pinned rules", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({
    op: "join",
    actor: "mara",
    claimed: ["vale"],
    present: ["vale"],
    world: opening(pinned, { seed: 17, history: true }),
  }).world;
  const request = {
    op: "play",
    actor: "vale",
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
    world,
    action: acceptPond,
  };
  const expected = pinned(request);
  compare(wasm(request), expected, "two-seat opening quest");
  assert.equal(expected.ok, true);
});
