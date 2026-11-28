import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_pond_return_view";
const approach = [
  "move:vale::pond",
  "move:vale::station",
  "read:vale:keeper-log:",
  "accept:vale::keeper",
  "move:vale::pond",
  "move:vale::station",
];
const moves = [
  "move:vale::pond",
  "move:vale:lamp:pond",
  "move:vale:cloth:pond",
];

test("Vale's Pond return projects Cloth, the active Keeper quest, and private speech", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const result = pinned(request);
    assert.equal(result.ok, true, result.error);
    return result;
  };
  const speech = (world, room) =>
    run({
      ...seats,
      op: "speech",
      world,
      room,
      lines: [
        { actorId: "vale", text: "The Greek ship is still out at sea." },
        { entityId: room, text: "The room is quiet." },
      ],
    }).world;
  let sample;
  let spokenView;
  for (const [seed, dry, priorSpeech] of [
    [undefined, false, false],
    [0, true, true],
    [2, false, true],
    [17, true, false],
    [42, false, true],
    [4242, false, false],
  ]) {
    let { world } = run({ op: "create", seed });
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      ({ world } = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }));
    }
    for (const action of approach) {
      ({ world } = run({ ...seats, op: "play", world, action }));
    }
    if (priorSpeech) world = speech(world, "station");
    for (const action of moves) {
      const expected = run({
        ...seats,
        op: "play",
        world,
        action: seed === 42 ? { key: action } : action,
        revision: world.revision,
      });
      const label = `${seed}/${dry}/${priorSpeech}/${action}`;
      sample = {
        ...seats,
        op,
        beforeSeq: world.eventSeq,
        world: {
          ...expected.world,
          playerActorId: seats.actor,
          heldActors: seats.claimed,
          controlledActors: seats.present,
          presentActors: seats.present,
        },
      };
      const actual = wasm(sample);
      assert.ok(isDeepStrictEqual(actual, expected), `completed ${label}`);
      assert.equal(actual.events.length, 1);
      assert.equal(actual.events[0].itemId, action.split(":")[2] || null);
      assert.equal(actual.world.revision, world.revision + 1);
      assert.equal(actual.world.actors.vale.heldItem, "cloth");
      assert.equal(actual.world.actors.vale.want.from, "quest:from:keeper");
      const keys = actual.actions.map(({ key }) => key);
      assert.equal(keys[3], "move:vale:cloth:station");
      assert.equal(keys.at(-3), "drop:vale:cloth:pond");
      assert.equal(keys.at(-1), "drop:vale:::0");
      const spoken = speech(actual.world, "pond");
      for (const saved of [actual.world, spoken]) {
        for (const present of [["vale"], []]) {
          const view = {
            ...seats,
            op: "view",
            world: saved,
            present,
            revision: saved.revision - 1,
          };
          const projected = wasm(view);
          assert.ok(
            isDeepStrictEqual(projected, run(view)),
            `view ${label}/${present}/${saved.revision}`,
          );
          assert.equal(projected.events, undefined);
          assert.equal(projected.world.memories.moth.learning, undefined);
          assert.equal(projected.world.revision, saved.revision);
          assert.deepEqual(projected.world.presentActors, present);
          if (saved === spoken) spokenView = view;
        }
      }
      assert.equal(wasm({ ...sample, world: spoken }), null);
    }
  }
  assert.equal(wasm({ ...sample, beforeSeq: sample.beforeSeq - 1 }), null);
  assert.equal(wasm({ ...sample, present: [] }), null);
  assert.equal(wasm({ ...spokenView, claimed: ["vale", "ada"] }), null);
  for (const change of [
    (world) => (world.actors.vale.want = null),
    (world) => (world.items.cloth.holder = "moth"),
    (world) => world.items.lamp.history.pop(),
    (world) => (world.log.at(-1).witnesses = ["vale"]),
    (world) => (world.revision = world.turn),
  ]) {
    const world = structuredClone(sample.world);
    change(world);
    assert.equal(wasm({ ...sample, world }), null);
    assert.equal(wasm({ ...sample, op: "view", world }), null);
  }
  const badSpeech = structuredClone(spokenView);
  badSpeech.world.log.at(-1).entityId = "station";
  assert.equal(wasm(badSpeech), null);
});
