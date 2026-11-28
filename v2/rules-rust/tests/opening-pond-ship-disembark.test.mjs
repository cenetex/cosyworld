import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const ship = "greek-ship";
const harbor = "greek-harbor";
const op = "opening_pond_ship_disembark";

test("Vale's first disembark matches pinned placement, custody, witnesses and discovery", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const primary =
      "    const respondent = perform(next, exact, round2, residents2);";
    assert.equal(source.split(primary).length, 2);
    return source.replace(
      primary,
      `$&
    if (next.turn === 11 && exact.kind === "move" && exact.target === "greek-harbor")
      globalThis.primary = structuredClone(next);`,
    );
  });
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  let sample;
  for (const seed of [undefined, 2, 17, 4242]) {
    for (const ordered of [false, true]) {
      let world = run({ op: "create", seed }).world;
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }).world;
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
      if (ordered)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      for (const action of [
        "drop:vale:lamp:pond",
        "move:vale:cloth:greek-ship",
        "course:vale::greek-harbor",
        "wait:vale::",
      ])
        world = play(world, action);
      for (const cloth of ["", "cloth"]) {
        const key = ["move", "vale", cloth, harbor].join(":");
        const request = {
          ...seats,
          op: "play",
          world,
          action: ordered ? { key } : key,
          revision: world.revision,
        };
        const reply = run(request);
        const primary = JSON.parse(JSON.stringify(reference.primary));
        sample = { ...request, op };
        const candidate = wasm(sample);
        const diff = Object.keys(primary).find(
          (field) =>
            !isDeepStrictEqual(candidate?.world[field], primary[field]),
        );
        assert.ok(
          isDeepStrictEqual(candidate, { ok: true, world: primary }),
          `${seed} ${ordered} ${key} ${diff ?? "envelope"}`,
        );
        const event = primary.log.at(-1);
        assert.deepEqual(reply.events[0], event);
        assert.equal(event.itemId, cloth || null);
        assert.equal(event.light, false);
        assert.equal(primary.actors.vale.heldItem, "cloth");
        assert.equal(primary.actors.vale.crossed, 3);
        assert.equal(
          primary.items.cloth.history.at(-1),
          "Turn 11: Vale carried it to The Wine-Dark Harbor.",
        );
        assert.deepEqual(primary.items.lamp, world.items.lamp);
        assert.deepEqual(primary.routeKnowledge, world.routeKnowledge);
        assert.deepEqual(primary.crossings["greek-harbor-pond"], {
          discovered: true,
        });
        assert.equal(primary.opening.met["greek-shipmaster"], 11);
        assert.equal(primary.packs["greek-drama"].met["greek-shipmaster"], 11);
        assert.deepEqual(
          primary.transports[ship].riders,
          seed === undefined ? ["ada"] : [],
        );
        assert.equal(primary.actors.ada.place, world.actors.ada.place);
      }
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(wasm({ ...sample, action: `move:vale:lamp:${harbor}` }), null);
  for (const mutate of [
    (world) => {
      world.transports[ship].phase = "sea";
    },
    (world) => {
      world.transports[ship].riders = [];
    },
    (world) => {
      delete world.routeKnowledge.vale;
    },
    (world) => {
      world.items.oil.holder = "cloth";
    },
    (world) => {
      world.items.lamp.lit = false;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
