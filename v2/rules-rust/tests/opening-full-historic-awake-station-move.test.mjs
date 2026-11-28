import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

test("historic Station arrivals with awake Pip return the complete pinned reply", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) => ({ ...seats, op: "play", world, action });
  let sample;
  for (const seed of [17, 99]) {
    const initial = run({ op: "create", history: true, seed }).world;
    const saved = run({ op: "create", save: JSON.stringify(initial) }).world;
    for (const dry of [false, true]) {
      let world = structuredClone(saved);
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      } else {
        world = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }).world;
      }
      const pond = run(play(world, "move:vale::pond")).world;
      const spoken = run({
        ...seats,
        op: "speech",
        world: pond,
        room: "pond",
        lines: [{ entityId: "pond", text: "Water laps the shore." }],
      }).world;
      for (const sorted of [false, true]) {
        for (const [key, previous] of [
          ["move:vale::station", pond],
          ["move:vale:lamp:station", spoken],
        ]) {
          const actors = sorted
            ? Object.fromEntries(Object.entries(previous.actors).toSorted())
            : previous.actors;
          const request = play({ ...previous, actors }, sorted ? { key } : key);
          const expected = run(request);
          const actual = wasm(request);
          const label = `${seed}/${dry}/${sorted}/${key}`;
          const different = Object.keys(expected.world).find(
            (name) =>
              !isDeepStrictEqual(actual?.world?.[name], expected.world[name]),
          );
          assert.ok(
            isDeepStrictEqual(actual, expected),
            `${label}/${different}`,
          );
          assert.deepEqual(
            actual.events.map(({ actorId }) => actorId),
            seed === 17
              ? ["vale", "moth", "orin", "keeper"]
              : ["vale", "moth", "keeper"],
          );
          assert.equal(
            actual.world.actors.moth.homeward,
            seed === 17 ? true : undefined,
          );
          assert.equal(actual.world.actors.keeper.sleeping, undefined);
          const view = { ...seats, op: "view", world: actual.world };
          assert.ok(isDeepStrictEqual(wasm(view), run(view)), `view ${label}`);
          sample = request;
        }
      }
    }
  }
  const forged = structuredClone(sample);
  forged.world.actors.keeper.sleeping.until += 1;
  assert.equal(wasm(forged), null);
  assert.equal(wasm({ ...sample, present: [] }), null);
});
