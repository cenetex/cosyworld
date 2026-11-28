import assert from "node:assert/strict";
import { test } from "node:test";
import cast from "../../card-game/shared-cast.json" with { type: "json" };
import { reducers } from "./parity.mjs";

function arrivalState(world) {
  return {
    hidden: world.hidden,
    absent: world.absent,
    doors: world.doors,
    places: cast.avatars.map(({ id }) => world.actors[id].place),
    belongings: cast.avatars.map(({ item }) => world.items[item.id]),
  };
}

test("opening arrivals match pinned shared creation", async () => {
  const { pinned, wasm } = await reducers();
  const players = cast.avatars
    .map(({ id }) => id)
    .filter((id) => id !== "vale");
  for (const [seed, history] of [
    [undefined, false],
    [1, false],
    [4242, true],
    [4_294_967_295, true],
  ]) {
    const create = { op: "create", seed, history };
    const baseline = pinned(create);
    assert.equal(baseline.ok, true, baseline.error);
    for (const [index, homecoming] of players.entries()) {
      const hidden = players[(index + 1) % players.length];
      const absent = [
        players[(index + 2) % players.length],
        players[(index + 3) % players.length],
      ];
      const request = { hidden, absent, homecoming };
      const reference = pinned({ ...create, ...request });
      assert.equal(reference.ok, true, reference.error);
      const candidate = wasm({
        op: "seed_arrivals",
        world: baseline.world,
        ...request,
      });
      assert.ok(
        candidate,
        `seed ${seed}, homecoming ${homecoming} was unsupported`,
      );
      assert.deepEqual(
        arrivalState(candidate.world),
        arrivalState(reference.world),
      );
    }
  }
});

test("opening arrivals decline conflicting avatars and already-played states", async () => {
  const { pinned, wasm } = await reducers();
  const world = pinned({ op: "create", seed: 3 }).world;
  const request = { op: "seed_arrivals", world };
  for (const choice of [
    { hidden: "vale" },
    { hidden: "unknown" },
    { absent: ["mara", "mara"] },
    { absent: ["ash"], hidden: "ash" },
    { hidden: "ash", homecoming: "ash" },
    { absent: "ash" },
  ]) {
    assert.equal(wasm({ ...request, ...choice }), null);
  }
  assert.equal(
    wasm({ ...request, world: { ...world, turn: 1 }, hidden: "mara" }),
    null,
  );
});
