import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_visitor_play";

function traceVisitors(source) {
  const marker =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `      const planned = read2 ?? plan(next, id).action;
      const capture = next.turn === 7 && actor === "vale" && exact.kind === "drop" && exact.item === "lamp"
        && next.actors.vale.place === "pond" && id !== "moth" && id !== "keeper";
      const before = capture && structuredClone(next);
      perform(next, planned, round2, residents2);
      if (capture) globalThis.visitors.push({ actor: id, key: planned.key, before, after: structuredClone(next) });`,
  );
}

test("Tavi and Sage can leave their homes after Vale calls the Pond ship", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceVisitors);
  const run = (request) => {
    const reply = pinned(request);
    assert.ok(reply.ok, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  let sample;
  for (const [seed, dry, spoken] of [
    [undefined, false, false],
    [0, true, false],
    [2, false, true],
    [17, false, false],
    [42, true, true],
    [4242, false, false],
    [4_294_967_295, true, false],
  ]) {
    let world = run({ op: "create", seed });
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      world = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
    }
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken) {
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      });
    }
    for (const action of [
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
      "move:vale::pond",
    ])
      world = play(world, action);
    for (const sorted of [false, true]) {
      const actors = sorted
        ? Object.fromEntries(Object.entries(world.actors).toSorted())
        : world.actors;
      reference.visitors = [];
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: { ...world, actors },
            action: "drop:vale:lamp:pond",
          }),
        ),
      );
      assert.ok(reply.ok, reply.error);
      const visitors = JSON.parse(JSON.stringify(reference.visitors));
      assert.deepEqual(visitors.map(({ actor }) => actor).toSorted(), [
        "ada",
        "ash",
        "mara",
        "nell",
        "orin",
        "rue",
        "tavi",
      ]);
      const moved = [];
      for (const { actor, key, before, after } of visitors) {
        const request = { op, actor, world: before };
        const actual = wasm(request);
        const label = `${seed} sorted=${sorted} ${key}`;
        const differing = Object.keys(after).find(
          (field) => !isDeepStrictEqual(actual?.world?.[field], after[field]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label}: ${actual ? differing : "unsupported"}`,
        );
        if (key === "move:ada::greek-ship") {
          moved.push(actor);
          assert.equal(after.items.shears.holder, "loft");
          assert.equal(after.actors.ada.dwellUntil, undefined);
          assert.deepEqual(
            after.transports["greek-ship"],
            before.transports["greek-ship"],
          );
          sample = request;
        } else if (key === "move:tavi::forest-oak") {
          moved.push(actor);
          assert.equal(after.items.kite.holder, "hill");
          assert.ok(after.actors.tavi.dwellUntil > after.turn);
        } else {
          assert.equal(key, `wait:${actor}::`, label);
          assert.ok(isDeepStrictEqual(after, before), label);
        }
      }
      assert.deepEqual(
        moved,
        seed === undefined
          ? sorted
            ? ["ada", "tavi"]
            : ["tavi", "ada"]
          : [2, 4242].includes(seed)
            ? ["tavi"]
            : [],
      );
    }
  }
  for (const change of [
    (world) => {
      world.items.shears.holder = "loft";
    },
    (world) => {
      world.transports["greek-ship"].since = 6;
    },
    (world) => {
      world.crossings["pond-greek-harbor"].method = "unknown";
    },
    (world) => {
      world.log.findLast((event) => event.verb === "give").accepted = false;
    },
  ]) {
    const world = structuredClone(sample.world);
    change(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
});
