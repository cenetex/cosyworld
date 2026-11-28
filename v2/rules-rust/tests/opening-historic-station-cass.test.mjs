import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const moveCass = { op: "opening_visitor_play", actor: "orin" };

function traceCass(source) {
  const marker =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(marker).length, 2);
  return source.replace(
    marker,
    `      const chosen = read2 ?? plan(next, id).action;
      const capture = id === "orin" && next.turn === 482 && next.actors.vale.place === "station";
      if (capture) globalThis.cass = { key: chosen.key, before: structuredClone(next) };
      perform(next, chosen, round2, residents2);
      if (capture) globalThis.cass.after = structuredClone(next);`,
  );
}

test("Cass waits with current seeded wants and leaves his board when pursuing the Swede", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceCass);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const [seed, restoredWillowsWant] of [[17, false], [99, false], [17, true]]) {
    const fresh = run({ op: "create", history: true, seed });
    const reopened = run({ op: "create", save: JSON.stringify(fresh) });
    const stowed = run({
      ...seats,
      op: "hold",
      world: reopened,
      choice: { item: null, revision: reopened.revision },
    });
    const pond = run({
      ...seats,
      op: "play",
      world: stowed,
      action: "move:vale::pond",
    });
    if (restoredWillowsWant) {
      pond.actors.orin.want.target = "willows-swede";
    }
    const sorted = Object.fromEntries(Object.entries(pond.actors).toSorted());
    for (const actors of [pond.actors, sorted]) {
      for (const route of ["move:vale::station", "move:vale:lamp:station"]) {
        reference.cass = undefined;
        const request = {
          ...seats,
          op: "play",
          world: { ...pond, actors },
          action: actors === sorted ? { key: route } : route,
        };
        const reply = JSON.parse(reference.cardShared(JSON.stringify(request)));
        assert.equal(reply.ok, true, reply.error);
        const { key, before, after } = JSON.parse(
          JSON.stringify(reference.cass),
        );
        const adaBeforeCass = seed === 99 && actors === sorted;
        assert.equal(before.log.at(-1).actorId, adaBeforeCass ? "ada" : "moth");
        assert.equal(before.eventSeq, before.arrival.seq + (adaBeforeCass ? 2 : 1));
        const actual = wasm({ ...moveCass, world: before });
        const label = `${seed} ${route} ${actors === sorted ? "sorted" : "authored"} restored=${restoredWillowsWant}`;
        if (!restoredWillowsWant) {
          assert.equal(key, "wait:orin::", label);
          assert.deepEqual(after, before);
          assert.equal(actual, null, label);
          continue;
        }
        assert.equal(key, "move:orin::willows-bank", label);
        assert.equal(before.items.board.holder, "orin");
        assert.equal(after.items.board.holder, "pavilion");
        assert.deepEqual(after.items.board.history, before.items.board.history);
        assert.equal(after.actors.orin.heldItem, null);
        assert.equal(after.actors.orin.dwellUntil, 507);
        assert.equal(after.crossings["pavilion-willows-bank"].discovered, true);
        const event = after.log.at(-1);
        assert.equal(event.seq, before.eventSeq + 1);
        assert.equal(event.text, "Cass goes to Crumbling Bank back outside.");
        assert.deepEqual(event.cast, ["orin"]);
        assert.deepEqual(event.witnesses, ["orin", "board"]);
        assert.ok(actual?.ok, `unsupported ${label}`);
        const field = Object.keys(after).find(
          (name) => !isDeepStrictEqual(actual.world[name], after[name]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label} ${field ?? "envelope"}`,
        );
        assert.equal(wasm({ ...moveCass, world: after }), null);
        sample = before;
      }
    }
  }
  for (const mutate of [
    (world) => {
      world.items.board.holder = "pavilion";
    },
    (world) => {
      world.log.at(-1).fromLocationId = "attic";
    },
    (world) => {
      world.doors.pavilion = "station";
    },
  ]) {
    const world = structuredClone(sample);
    mutate(world);
    assert.equal(wasm({ ...moveCass, world }), null);
  }
});
