import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function opening(pinned, options) {
  const { world } = pinned({ op: "create", ...options });
  return pinned({ op: "join", ...seats, claimed: [], present: [], world })
    .world;
}

test("opening lamp holds and presence match the pinned JavaScript reducer", async () => {
  const { pinned, wasm } = await reducers();
  const variants = [
    {},
    { hidden: "mara", absent: ["ash", "nell"] },
    { homecoming: "rue" },
    { homecoming: "orin" },
  ];
  const seeds = [0, 17, 4242, 4_294_967_295];
  for (const seed of seeds) {
    for (const variant of variants) {
      for (const history of [false, true]) {
        let world = opening(pinned, { seed, history, ...variant });
        const { turn, revision } = world;
        const step = (operation) => {
          const request = { ...seats, world, ...operation };
          const actual = wasm(request);
          const expected = pinned(request);
          if (!isDeepStrictEqual(actual, expected)) {
            const field = Object.keys(expected.world ?? {}).find(
              (key) =>
                !isDeepStrictEqual(actual?.world?.[key], expected.world[key]),
            );
            assert.fail(
              `${JSON.stringify({ seed, history, variant, operation })} differs in ${field ?? "response"}`,
            );
          }
          world = actual.world;
        };
        step({ op: "presence" });
        step({ op: "hold", choice: { item: null, revision } });
        assert.equal(world.items.lamp.lit, false);
        assert.deepEqual(world.opened, { pond: ["vale"] });
        step({ op: "presence", present: [] });
        step({ op: "presence" });
        step({ op: "hold", choice: { item: "lamp", revision: revision + 1 } });
        assert.equal(world.items.lamp.lit, true);
        step({ op: "hold", choice: { item: null, revision: revision + 2 } });
        assert.equal(world.items.lamp.fuel, 12);
        assert.deepEqual(world.opened, { pond: ["vale"] });
        assert.equal(world.turn, turn);
        assert.equal(world.revision, revision + 3);
      }
    }
  }
});

test("the opening slice declines stale, unseated, and out-of-scope holds", async () => {
  const { pinned, wasm } = await reducers();
  const world = opening(pinned, { seed: 17 });
  const request = {
    op: "hold",
    ...seats,
    world,
    choice: { item: null, revision: 0 },
  };
  const later = structuredClone(world);
  later.turn = 1;
  later.revision = 1;
  const covered = structuredClone(world);
  covered.items.cloth.holder = "lamp";
  const stationKey = structuredClone(world);
  stationKey.items.routes.holder = "keeper";
  for (const changes of [
    { present: [] },
    { claimed: [] },
    { world: later, choice: { item: null, revision: 1 } },
    { world: covered },
    { world: stationKey },
    { choice: { item: null, revision: 1 } },
    { choice: { item: "routes", revision: 0 } },
    { choice: { item: null, revision: 0, actor: "mara" } },
  ]) {
    assert.equal(wasm({ ...request, ...changes }), null);
  }
});

test("grounded station doors keep their first-open order", async () => {
  const { pinned, wasm } = await reducers();
  const world = opening(pinned, { seed: 17, history: true });
  world.doors.train = world.doors.pavilion = "station";
  world.items.routes.holder = world.items.board.holder = "station";
  world.stationExitOrder = ["pavilion"];
  const request = { ...seats, op: "presence", world };
  const actual = wasm(request);
  assert.ok(isDeepStrictEqual(actual, pinned(request)));
  assert.deepEqual(actual.world.stationExitOrder, ["pavilion", "train"]);
});

test("resident empty-hand holds preserve the opening lantern state", async () => {
  const { pinned, wasm } = await reducers();
  const actors = ["mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
  for (const seed of [0, 17, 4242]) {
    for (const history of [false, true]) {
      const world = opening(pinned, { seed, history });
      const unlit = pinned({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }).world;
      const grounded = pinned({ ...seats, op: "reset", world }).world;
      for (const state of [world, unlit, grounded]) {
        for (const actor of actors) {
          const request = {
            actor,
            claimed: ["vale", actor],
            present: ["vale", actor],
            op: "hold",
            world: state,
            choice: { item: null, revision: state.revision },
          };
          const actual = wasm(request);
          assert.ok(
            isDeepStrictEqual(actual, pinned(request)),
            `${actor} seed ${seed} history ${history} revision ${state.revision}`,
          );
          assert.equal(actual.world.revision, state.revision + 1);
          assert.deepEqual(actual.world.items.lamp, state.items.lamp);
          assert.equal(wasm({ ...request, present: ["vale"] }), null);
          assert.equal(
            wasm({ ...request, choice: { ...request.choice, item: "lamp" } }),
            null,
          );
        }
      }
    }
  }
});
