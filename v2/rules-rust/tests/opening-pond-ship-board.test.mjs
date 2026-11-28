import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_pond_ship_board";
const ship = "greek-ship";

function capturePrimary(source) {
  const boundary =
    "    const respondent = perform(next, exact, round2, residents2);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `${boundary}
    if (actor === "vale" && exact.kind === "move" && exact.target === "greek-ship")
      globalThis.boarded = structuredClone(next);`,
  );
}

test("Vale's first boarding of The Charybdis matches the pinned primary Move", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capturePrimary);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const sorted of [false, true]) {
      let world = run({ op: "create", seed });
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
      for (const action of [
        "move:vale::pond",
        "move:vale::station",
        "read:vale:keeper-log:",
        "accept:vale::keeper",
        "move:vale::pond",
        "move:vale::station",
        "move:vale::pond",
      ])
        world = play(world, action);
      if (sorted)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      world = play(world, "drop:vale:lamp:pond");
      assert.equal(world.transports[ship].dock, "pond");
      for (const key of [`move:vale::${ship}`, `move:vale:cloth:${ship}`]) {
        reference.boarded = undefined;
        const request = {
          ...seats,
          op: "play",
          world,
          action: sorted ? { key } : key,
          revision: world.revision,
        };
        const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
        assert.equal(reply.ok, true, reply.error);
        const expected = JSON.parse(JSON.stringify(reference.boarded));
        const actual = wasm({ ...request, op });
        const label = `${seed} ${sorted} ${key}`;
        assert.ok(actual, `unsupported ${label}`);
        const field = Object.keys(expected).find(
          (name) => !isDeepStrictEqual(actual.world[name], expected[name]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: expected }),
          `${label} ${field ?? "envelope"}`,
        );
        const boarded = actual.world;
        const event = boarded.log.at(-1);
        assert.deepEqual(reply.events, [event]);
        assert.equal(event.fromLocationId, "pond");
        assert.equal(event.locationId, ship);
        assert.equal(event.itemId, key.includes(":cloth:") ? "cloth" : null);
        assert.equal(boarded.actors.vale.crossed, 2);
        assert.deepEqual(boarded.actors.vale.visited, [
          ...world.actors.vale.visited,
          ship,
        ]);
        assert.equal(boarded.items.cloth.holder, "vale");
        assert.deepEqual(boarded.items.lamp, world.items.lamp);
        assert.deepEqual(boarded.transports[ship], {
          ...world.transports[ship],
          since: 8,
        });
        assert.deepEqual(reply.exits, ["greek-harbor"]);
        assert.ok(
          reply.actions.some(({ key }) => key === "course:vale::greek-harbor"),
        );
        if (seed === undefined) {
          assert.ok(event.cast.includes("ada"));
          assert.equal(boarded.opening.met.ada, 8);
          assert.equal(boarded.packs["shared-homes"].met.ada, 8);
        } else assert.deepEqual(event.cast, ["vale"]);
        sample = { ...request, op };
      }
    }
  }
  for (const mutate of [
    (world) => {
      world.transports[ship].dock = "greek-harbor";
    },
    (world) => {
      world.crossings["pond-greek-harbor"].discovered = false;
    },
    (world) => {
      world.actors.rue.place = ship;
    },
    (world) => {
      world.actors.ada.place = ship;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, selectedIds: ["cloth"] }), null);
  assert.equal(wasm({ ...sample, action: `move:vale:lamp:${ship}` }), null);
});
