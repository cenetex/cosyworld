import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const actions = [
  "move:vale::pond",
  "move:vale::station",
  "read:vale:keeper-log:",
  "accept:vale::keeper",
  "move:vale::pond",
  "move:vale::station",
  "move:vale::pond",
  "drop:vale:lamp:pond",
  "move:vale:cloth:greek-ship",
  "course:vale::greek-harbor",
  "wait:vale::",
  "move:vale::greek-harbor",
];

function exact(actual, expected, label) {
  const field = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.ok(isDeepStrictEqual(actual, expected), `${label} ${field ?? ""}`);
}

test("Presence preserves four voyage scenes and their private speech cues", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  let sample;
  for (const [seed, sorted] of [
    [undefined, false],
    [17, true],
  ]) {
    let { world } = run({ op: "create", seed });
    ({ world } = run({
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    }));
    for (const action of actions) {
      if (sorted) {
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      }
      ({ world } = run({ ...seats, op: "play", world, action }));
      if (world.turn < 8) continue;
      const room = world.turn === 11 ? "greek-harbor" : "greek-ship";
      const label = `${seed}/${world.turn}`;
      assert.equal(world.actors.vale.place, room);
      assert.equal(world.actors.ada.place === room, seed === undefined);
      const speakers =
        world.turn === 11
          ? ["vale", "greek-shipmaster"]
          : world.turn === 8 && seed === undefined
            ? ["vale", "ada"]
            : ["vale"];
      assert.deepEqual(world.speechVoices.vale, speakers);
      const speech = {
        ...seats,
        op: "speech",
        world,
        room,
        lines: [
          { actorId: "vale", text: "I can see the horizon." },
          { entityId: room, text: "The waves seem to slow." },
        ],
      };
      const spoken = run(speech).world;
      for (const saved of [world, spoken]) {
        let current = saved;
        for (const [claimed, present] of [
          [seats.claimed, []],
          [[], []],
          [seats.claimed, seats.present],
        ]) {
          const request = {
            ...seats,
            op: "presence",
            world: current,
            claimed,
            present,
          };
          const expected = run(request);
          exact(
            expected,
            { ok: true, world: saved },
            `${label} pinned presence`,
          );
          const actual = wasm(request);
          exact(actual, expected, `${label} presence ${claimed}/${present}`);
          current = actual.world;
        }
        for (const present of [[], seats.present]) {
          const view = { ...seats, op: "view", world: current, present };
          exact(wasm(view), run(view), `${label} private ${present}`);
        }
      }
      sample = { ...seats, op: "presence", world: spoken };
    }
  }
  for (const invalid of [
    { ...sample, claimed: [] },
    { ...sample, present: ["vale", "vale"] },
  ]) {
    assert.equal(pinned(invalid).ok, false);
    assert.equal(wasm(invalid), null);
  }
  const extraSeat = { ...sample, claimed: ["vale", "ada"] };
  assert.equal(pinned(extraSeat).ok, true);
  assert.equal(wasm(extraSeat), null);

  const forged = structuredClone(sample);
  forged.world.log.at(-1).speaker = "Sage";
  assert.equal(wasm(forged), null);

  const relight = structuredClone(sample);
  relight.world.items.lamp.lit = false;
  assert.equal(run(relight).world.items.lamp.lit, true);
  assert.equal(wasm(relight), null);

  const abandonedPost = structuredClone(sample);
  abandonedPost.world.actors.ada.guarding = "greek-harbor";
  assert.equal(run(abandonedPost).world.actors.ada.guarding, undefined);
  assert.equal(wasm(abandonedPost), null);
});
