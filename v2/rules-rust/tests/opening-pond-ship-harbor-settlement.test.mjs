import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const harbor = "greek-harbor";
const life = "opening_ship_harbor_life";
const tail = "opening_ship_harbor_tail";

function captureHarbor(source) {
  const cuts = [
    ["afterResidents", "    const rings2 = next.log.filter("],
    ["beforeWants", "    reviseStalledWants(\n      next,"],
    [
      "finished",
      "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));",
      true,
    ],
  ];
  for (const [name, marker, after] of cuts) {
    assert.equal(source.split(marker).length, 2);
    const capture = `    if (next.turn === 11 && exact.kind === "move" && exact.target === "${harbor}") globalThis.${name} = structuredClone(next);`;
    source = source.replace(
      marker,
      after ? `$&\n${capture}` : `${capture}\n$&`,
    );
  }
  return source;
}

test("the first Harbor arrival has quiet resident life and resets Vale's visit speech", async () => {
  const { wasm } = await reducers();
  const reference = currentSharedEngine(captureHarbor);
  const captured = (name) => JSON.parse(JSON.stringify(reference[name]));
  const run = (request) => {
    const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
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
      for (const action of [
        "drop:vale:lamp:pond",
        "move:vale:cloth:greek-ship",
        "course:vale::greek-harbor",
        "wait:vale::",
      ])
        world = play(world, action);
      for (const item of ["", "cloth"]) {
        const key = ["move", "vale", item, harbor].join(":");
        play(world, sorted ? { key } : key);
        const residents = captured("afterResidents");
        const pinned = captured("beforeWants");
        const finished = captured("finished");
        const label = JSON.stringify({ seed, sorted, item });
        assert.deepEqual(pinned, residents);
        assert.ok(
          isDeepStrictEqual(wasm({ op: life, world: residents }), {
            ok: true,
            world: pinned,
          }),
          `${label} life`,
        );
        sample = { op: tail, before: world, world: pinned };
        assert.ok(
          isDeepStrictEqual(wasm(sample), { ok: true, world: finished }),
          `${label} tail`,
        );
        assert.deepEqual(finished.actors.keeper.contact, {
          moth: [11, 0],
          vale: [7, 0],
        });
        assert.deepEqual(finished.actors.vale.waitSpeech, {
          place: harbor,
          turn: null,
        });
      }
    }
  }
  const wrongBerth = structuredClone(sample.world);
  wrongBerth.transports["greek-ship"].phase = "arrived";
  assert.equal(wasm({ op: life, world: wrongBerth }), null);
  const unrecognized = structuredClone(sample.world);
  delete unrecognized.opening.met["greek-shipmaster"];
  assert.equal(wasm({ op: life, world: unrecognized }), null);
  const heard = structuredClone(sample.world);
  heard.packs["greek-drama"].flags ??= {};
  heard.packs["greek-drama"].flags["greek-polynices-heard"] = true;
  assert.equal(wasm({ op: life, world: heard }), null);
  const rewound = structuredClone(sample.world);
  rewound.actors.keeper.contact.moth = [9, 0];
  assert.equal(wasm({ ...sample, world: rewound }), null);
  const misplaced = structuredClone(sample.world);
  const log = misplaced.log;
  [log[log.length - 3], log[log.length - 2]] = [log.at(-2), log.at(-3)];
  assert.equal(wasm({ ...sample, world: misplaced }), null);
  assert.equal(
    wasm({
      ...sample,
      before: { ...sample.before, revision: sample.before.revision - 1 },
    }),
    null,
  );
});
