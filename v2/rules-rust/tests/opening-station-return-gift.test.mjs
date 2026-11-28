import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_keeper_return_gift";
const complete = "opening_keeper_return_reply";

function traceGift(source) {
  const resident =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(resident).length, 2);
  return source.replace(
    resident,
    `      const chosen = read2 ?? plan(next, id).action;
      const gift = id === "moth" && next.turn === 5 &&
        exact.target === "station" && exact.kind === "move";
      if (gift) globalThis.before = structuredClone(next);
      perform(next, chosen, round2, residents2);
      if (gift) {
        globalThis.action = chosen.key;
        globalThis.after = structuredClone(next);
      }`,
  );
}

test("Pip’s Cloth gift, Station reply, and reload preserve the active Keeper quest", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceGift);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  const play = (world, action) => run({ ...seats, op: "play", world, action });
  const observe = (world, action) => {
    const reply = JSON.parse(
      reference.cardShared(
        JSON.stringify({ ...seats, op: "play", world, action }),
      ),
    );
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reference.action, "give:moth:cloth:vale");
    return [
      ...JSON.parse(JSON.stringify([reference.before, reference.after])),
      reply,
    ];
  };
  let sample, unaccepted, withRue, completed;
  let quietCases = 0;
  for (const seed of [undefined, 2, 17, 42, 99, 4242]) {
    for (const dry of [false, true]) {
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
      const move = (where) => `move:vale:${dry ? "lamp" : ""}:${where}`;
      world = play(play(world, "move:vale::pond"), move("station"));
      const read = play(world, "read:vale:keeper-log:");
      if (seed === undefined && !dry) {
        [unaccepted] = observe(play(read, move("pond")), move("station"));
      }
      world = play(play(read, "accept:vale::keeper"), move("pond"));
      if (seed === undefined && !dry) {
        const visitor = structuredClone(world);
        visitor.actors.rue.place = "station";
        visitor.packs["shared-homes"].met.rue = 2;
        const [before, after] = observe(visitor, move("station"));
        assert.equal(after.log.at(-1).cast.length, 4);
        assert.ok(after.log.at(-1).witnesses.includes("rue"));
        withRue = before;
      }
      if (dry)
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      const [before, after, full] = observe(world, move("station"));
      const label = `${seed}/${dry}`;
      assert.equal(before.actors.vale.want.from, "quest:from:keeper", label);
      assert.deepEqual(after.actors.vale.want, before.actors.vale.want, label);
      assert.equal(after.items.cloth.holder, "vale", label);
      assert.equal(after.memories.moth.learning.at(-1).reward, -5, label);
      assert.equal(after.eventSeq, before.eventSeq + 1, label);
      const actual = wasm({ op, world: before });
      if (after.log.at(-1).cast.length !== 3) {
        assert.equal(actual, null, label);
      } else {
        const field = Object.keys(after).find(
          (key) => !isDeepStrictEqual(actual?.world[key], after[key]),
        );
        assert.ok(
          isDeepStrictEqual(actual, { ok: true, world: after }),
          `${label} ${field}`,
        );
        assert.equal(wasm({ op, world: after }), null, label);
        completed = {
          ...seats,
          op: complete,
          beforeSeq: world.eventSeq,
          world: full.world,
        };
        const actualReply = wasm(completed);
        assert.ok(isDeepStrictEqual(actualReply, full), `completed ${label}`);
        assert.equal(actualReply.actions.at(-1).key, "drop:vale:::0", label);
        for (const present of [["vale"], []]) {
          const view = { ...seats, op: "view", world: full.world, present };
          const expected = pinned(view);
          const actualView = wasm(view);
          assert.ok(
            isDeepStrictEqual(actualView, expected),
            `view ${label}/${present}`,
          );
          assert.equal(actualView.world.memories.moth.learning, undefined);
          assert.equal(actualView.events, undefined);
        }
        sample = before;
        quietCases += 1;
      }
    }
  }
  assert.ok(quietCases >= 10);
  assert.equal(wasm({ op, world: unaccepted }), null);
  assert.equal(wasm({ op, world: withRue }), null);
  assert.equal(
    wasm({ ...completed, beforeSeq: completed.beforeSeq - 1 }),
    null,
  );
  for (const change of [
    (world) => (world.actors.vale.want = null),
    (world) => (world.log.at(-2).witnesses = world.log.at(-1).witnesses),
    (world) =>
      (world.log.at(-1).items.find((item) => item.id === "cloth").holder =
        "moth"),
    (world) => delete world.life.actors.vale.attachments.cloth,
  ]) {
    const world = structuredClone(completed.world);
    change(world);
    assert.equal(wasm({ ...completed, world }), null);
    assert.equal(wasm({ ...completed, op: "view", world }), null);
  }
  for (const change of [
    (world) => (world.arrival.fromLocationId = "attic"),
    (world) => (world.items.cloth.holder = "station"),
    (world) => delete world.knowledge.known.vale["quest:keeper:pond"],
    (world) => (world.memories.moth.learning[1].reward = 0),
    (world) => (world.log.at(-3).witnesses = ["vale", "moth"]),
    (world) => (world.log.at(-1).cast = ["vale", "keeper"]),
  ]) {
    const invalid = structuredClone(sample);
    change(invalid);
    assert.equal(wasm({ op, world: invalid }), null);
  }
});
