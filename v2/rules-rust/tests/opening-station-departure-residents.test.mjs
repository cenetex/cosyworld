import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_departure_residents";

function traceResidents(source) {
  const cuts = [
    [
      "    const respondent = perform(next, exact, round2, residents2);",
      "primary",
    ],
    ["    const rings2 = next.log.filter(", "settled"],
    [
      "      perform(next, read2 ?? plan(next, id).action, round2, residents2);",
      "plans",
    ],
  ];
  for (const [marker, name] of cuts) {
    assert.equal(source.split(marker).length, 2, marker);
    const capture = `globalThis.cuts.${name} = structuredClone(next);`;
    if (name === "primary")
      source = source.replace(marker, `${marker}\n${capture}`);
    else if (name === "settled")
      source = source.replace(marker, `${capture}\n${marker}`);
    else
      source = source.replace(
        marker,
        `const action = read2 ?? plan(next, id).action;
         globalThis.cuts.plans.push([id, action.key]);
         perform(next, action, round2, residents2);`,
      );
  }
  return source;
}

test("the ordinary residents wait after both first quiet Station departures", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceResidents);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  for (const seed of [undefined, 2, 17, 42, 4242]) {
    for (const dry of [false, true]) {
      let station = run({ op: "create", seed });
      if (dry)
        Object.assign(station.items.lamp, {
          fuel: 0,
          fuelRooms: 0,
          lit: false,
        });
      else
        station = run({
          ...seats,
          op: "hold",
          world: station,
          choice: { item: null, revision: station.revision },
        });
      const lamp = dry ? "lamp" : "";
      station = play(
        play(station, "move:vale::pond"),
        `move:vale:${lamp}:station`,
      );
      for (const to of ["behind-station", "pond"]) {
        const before =
          to === "pond"
            ? play(
                play(station, "read:vale:keeper-log:"),
                "accept:vale::keeper",
              )
            : station;
        const action = `move:vale:${lamp}:${to}`;
        reference.cuts = { plans: [] };
        const reply = JSON.parse(
          reference.cardShared(
            JSON.stringify({ ...seats, op: "play", world: before, action }),
          ),
        );
        assert.equal(reply.ok, true, reply.error);
        const { primary, settled, plans } = JSON.parse(
          JSON.stringify(reference.cuts),
        );
        const label = `${seed} ${action}`;
        assert.deepEqual(settled, primary, label);
        assert.deepEqual(
          plans.map(([actor]) => actor).toSorted(),
          [
            "ada",
            "ash",
            "keeper",
            "mara",
            "moth",
            "nell",
            "orin",
            "rue",
            "tavi",
          ],
          label,
        );
        assert.ok(
          plans.every(([actor, key]) => key === `wait:${actor}::`),
          label,
        );
        const request = { op, world: primary };
        const actual = wasm(request);
        assert.ok(actual?.ok, `unsupported ${label}`);
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: settled }),
          label,
        );
        if (seed === 4242) sample = request;
      }
    }
  }
  for (const mutate of [
    (world) => {
      world.actors.moth.dwellUntil = world.turn;
    },
    (world) => {
      world.actors.keeper.want.step.verb = "bring";
    },
    (world) => {
      world.actors.orin.dwellUntil = world.turn;
    },
    (world) => {
      world.arrival.seq -= 1;
    },
  ]) {
    const world = structuredClone(sample.world);
    mutate(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
