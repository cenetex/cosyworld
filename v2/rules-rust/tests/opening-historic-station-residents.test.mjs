import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const op = "opening_station_residents";
const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function traceResidentTurns(source) {
  const loop = "    for (const id of residents2) {";
  const play =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  const bell = "    const rings2 = next.log.filter(";
  for (const marker of [loop, play, bell])
    assert.equal(source.split(marker).length, 2);
  return source
    .replace(
      loop,
      `    globalThis.residentTurns = {before:structuredClone(next), plans:[]};\n${loop}`,
    )
    .replace(
      play,
      `      const action = read2 ?? plan(next, id).action;
      globalThis.residentTurns.plans.push(action.key);
      perform(next, action, round2, residents2);`,
    )
    .replace(
      bell,
      `    globalThis.residentTurns.after = structuredClone(next);\n${bell}`,
    );
}

test("historic Station resident plays leave the exact sleeping-Pip phase unchanged", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceResidentTurns);
  const success = (reply) => {
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let saved;
  for (const seed of [undefined, 2, 42, 4242, 17, 5]) {
    for (const lamp of ["stowed", "dry"]) {
      let world = success(pinned({ op: "create", seed, history: true }));
      if (lamp === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      } else {
        world = success(
          pinned({
            ...seats,
            op: "hold",
            world,
            choice: { item: null, revision: world.revision },
          }),
        );
      }
      world = success(
        pinned({ ...seats, op: "play", world, action: "move:vale::pond" }),
      );
      if (seed === 2 || seed === 4242)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );

      for (const action of [
        "move:vale::station",
        { key: "move:vale:lamp:station" },
      ]) {
        const request = { ...seats, op: "play", world, action };
        success(JSON.parse(reference.cardShared(JSON.stringify(request))));
        const { before, after, plans } = JSON.parse(
          JSON.stringify(reference.residentTurns),
        );
        assert.equal(before.turn, 482);
        assert.equal(before.eventSeq, before.arrival.seq);
        const actual = wasm({ op, world: before });
        const label = JSON.stringify({ seed, lamp, action });
        if (seed === 17 || seed === 5) {
          assert.equal(actual, null, label);
          assert.ok(
            plans.includes(
              seed === 17 ? "move:moth::station" : "move:nell::forest-cottage",
            ),
            label,
          );
          if (seed === 5) assert.ok(before.actors.moth.sleeping, label);
          assert.ok(after.eventSeq > before.eventSeq, label);
        } else {
          assert.ok(before.actors.moth.sleeping, label);
          assert.ok(!plans.some((key) => key.startsWith("wait:moth:")), label);
          assert.equal(plans.includes("wait:keeper::"), seed !== 4242, label);
          if (seed === 42) {
            assert.equal(before.actors.tavi.sleeping.until, 482);
            assert.ok(!plans.includes("wait:tavi::"), label);
          }
          assert.ok(
            plans.every((key) => /^wait:[a-z]+::$/.test(key)),
            label,
          );
          assert.ok(isDeepStrictEqual(before, after), label);
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: after }),
            label,
          );
          saved = before;
        }
      }
    }
  }
  for (const corrupt of [
    (world) => {
      world.log.at(-1).witnesses = ["vale", "lamp"];
    },
    (world) => {
      world.actors.rue.place = "station";
    },
    (world) => {
      world.actors.moth.sleeping.until = 482;
    },
  ]) {
    const world = structuredClone(saved);
    corrupt(world);
    assert.equal(wasm({ op, world }), null);
  }
});
