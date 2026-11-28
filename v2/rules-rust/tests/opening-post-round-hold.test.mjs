import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const wait = "wait:vale::";
const drop = "drop:vale:lamp:attic";
const take = "take:vale:lamp:";

function hold(world, item) {
  return {
    ...seats,
    op: "hold",
    world,
    choice: { item, revision: world.revision },
  };
}

test("quiet attic holds and presence match pinned first and second rounds", async () => {
  const { pinned, wasm } = await reducers();
  const save = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => save({ ...seats, op: "play", world, action });
  const speak = (world) =>
    save({
      ...seats,
      op: "speech",
      world,
      room: "attic",
      entries: [],
      lines: [
        ...(world.speechVoices.vale.includes("vale")
          ? [{ entityId: "vale", actorId: "vale", text: "The attic is quiet." }]
          : []),
        { entityId: "attic", actorId: null, text: "The shutters rattle." },
      ],
    });
  const cases = [
    { seed: undefined },
    { seed: 2 },
    { seed: 17 },
    { seed: 4242 },
    { seed: 42, history: true },
    { seed: 4_294_967_295, history: true },
  ];
  for (const options of cases) {
    for (const lamp of ["held", "stowed", "dry"]) {
      let world = save({ op: "create", ...options });
      if (lamp === "stowed") world = save(hold(world, null));
      if (lamp === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const waited = play(world, wait);
      const firstSpeech = speak(waited);
      const states = [waited, firstSpeech];
      if (!options.history) {
        const waitedAgain = play(firstSpeech, wait);
        const dropped = play(world, drop);
        const taken = play(speak(dropped), take);
        states.push(waitedAgain, speak(waitedAgain), taken, speak(taken));
        assert.equal(wasm(hold(dropped, "lamp")), null);
      }
      for (const saved of states) {
        for (const present of [[], ["vale"]]) {
          const request = { ...seats, op: "presence", world: saved, present };
          const expected = pinned(request);
          assert.equal(expected.ok, true, expected.error);
          const label = `${options.seed} ${lamp} turn ${saved.turn} present ${present.length}`;
          assert.ok(isDeepStrictEqual(wasm(request), expected), label);
          assert.ok(isDeepStrictEqual(expected.world, saved), label);
        }
        let current = saved;
        for (const item of [null, "lamp", null]) {
          const request = hold(current, item);
          const expected = pinned(request);
          const actual = wasm(request);
          const position = saved.log.findLast(
            (entry) => entry.kind === "action" && entry.actorId === "vale",
          ).verb;
          const label = `${options.seed} ${lamp} ${position} at ${saved.turn} revision ${current.revision}`;
          assert.equal(expected.ok, true, expected.error);
          assert.ok(actual?.ok, label);
          assert.deepEqual(
            Object.keys(actual).sort(),
            Object.keys(expected).sort(),
          );
          assert.ok(
            isDeepStrictEqual(actual.world, expected.world),
            `${label}: ${Object.keys(expected.world).find((key) => !isDeepStrictEqual(actual.world[key], expected.world[key])) ?? "extra saved fields"}`,
          );
          assert.equal(actual.world.revision, current.revision + 1);
          assert.equal(actual.world.turn, saved.turn);
          assert.equal(actual.world.items.lamp.fuel, saved.items.lamp.fuel);
          assert.equal(
            actual.world.items.lamp.lit,
            item === "lamp" && lamp !== "dry",
          );
          current = actual.world;
        }
      }
      const invalid = structuredClone(waited);
      invalid.log.find(
        (entry) => entry.verb === "wait" && entry.actorId === "vale",
      ).sleep = true;
      assert.equal(wasm(hold(invalid, null)), null);
      assert.equal(wasm({ ...hold(waited, null), present: [] }), null);
      const presence = { ...seats, op: "presence", world: waited };
      assert.equal(wasm({ ...presence, world: invalid }), null);
      assert.equal(wasm({ ...presence, present: ["mara"] }), null);
      assert.equal(wasm({ ...presence, claimed: [] }), null);
      assert.equal(
        wasm({ ...hold(waited, null), claimed: ["vale", "mara"] }),
        null,
      );
      assert.equal(
        wasm({
          ...hold(waited, null),
          choice: { item: null, revision: waited.revision - 1 },
        }),
        null,
      );
    }
  }
});
