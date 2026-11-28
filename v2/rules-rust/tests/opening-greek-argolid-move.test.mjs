import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const harbor = "greek-harbor";
const road = "greek-argolid-road";
const op = "opening_greek_argolid_move";

test("Vale's first Argolid Move preserves cargo, witnesses and Harbor captions", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const primary =
      "    const respondent = perform(next, exact, round2, residents2);";
    assert.equal(source.split(primary).length, 2);
    return source.replace(
      primary,
      `$&
    if (next.turn === 12 && exact.kind === "move" && exact.target === "greek-argolid-road")
      globalThis.primary = structuredClone(next);`,
    );
  });
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  for (const seed of [undefined, 17]) {
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
        world = play(world, action).world;
      if (ordered)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      for (const action of [
        "drop:vale:lamp:pond",
        "move:vale::greek-ship",
        "course:vale::greek-harbor",
        "wait:vale::",
      ])
        world = play(world, action).world;
      const landed = play(
        world,
        ordered ? "move:vale:cloth:greek-harbor" : "move:vale::greek-harbor",
      );
      const captions = run({
        ...seats,
        op: "speech",
        room: harbor,
        world: landed.world,
        lines: [
          { actorId: "vale", text: "The next road leads inland." },
          {
            actorId: "greek-shipmaster",
            text: "Follow the road out of the harbor.",
          },
          { entityId: harbor, text: "Pale water folds against the stones." },
        ],
      });
      const keys = [`move:vale::${road}`, `move:vale:cloth:${road}`];
      assert.ok(
        keys.every((key) =>
          landed.actions.some((action) => action.key === key),
        ),
      );
      for (const prior of [landed.world, captions.world]) {
        for (const key of keys) {
          const request = {
            ...seats,
            op: "play",
            world: prior,
            action: ordered ? { key } : key,
            revision: prior.revision,
          };
          const reply = run(request);
          const primary = JSON.parse(JSON.stringify(reference.primary));
          sample = { ...request, op };
          const actual = wasm(sample);
          const difference = Object.keys(primary).find(
            (field) => !isDeepStrictEqual(actual?.world[field], primary[field]),
          );
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: primary }),
            `${seed} ${ordered} ${key} ${prior.eventSeq} ${difference ?? "envelope"}`,
          );
          const event = primary.log.at(-1);
          assert.deepEqual(reply.events, [event]);
          assert.equal(primary.arrival.seq, prior.eventSeq + 1);
          assert.deepEqual(event.witnesses, [
            "vale",
            "greek-shipmaster",
            ...(seed === undefined ? ["ada"] : []),
            "greek-helen-accounts",
            ...(seed === 17 ? ["ratiradio-raven-figurine"] : []),
            "cloth",
          ]);
          assert.deepEqual(
            event.items.map((item) => item.id),
            ["greek-atreid-record", "cloth"],
          );
          assert.equal(primary.actors.vale.crossed, 3);
          assert.equal(
            primary.items.cloth.history.at(-1),
            "Turn 12: Vale carried it to The Argolid Crossroads.",
          );
          assert.deepEqual(primary.items.lamp, prior.items.lamp);
          assert.deepEqual(primary.transports, prior.transports);
          assert.deepEqual(primary.crossings, prior.crossings);
          assert.deepEqual(primary.routeKnowledge, prior.routeKnowledge);
          if (prior === captions.world)
            assert.deepEqual(primary.log.slice(-4, -1), captions.lines);
        }
      }
    }
  }
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...sample, revision: sample.revision - 1 }), null);
  assert.equal(
    wasm({ ...sample, action: "move:vale::greek-road-thebes" }),
    null,
  );
  for (const mutate of [
    (world) => {
      world.log.at(-1).generated = false;
    },
    (world) => {
      world.actors["greek-shipmaster"].place = road;
    },
    (world) => {
      world.items.oil.holder = "cloth";
    },
    (world) => {
      world.items["greek-atreid-record"].holder = harbor;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
