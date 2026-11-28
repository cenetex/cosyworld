import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_historic_awake_station_view";

function exact(actual, expected, label) {
  const field = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.ok(isDeepStrictEqual(actual, expected), `${label} ${field ?? ""}`);
}

test("awake historic Station speech and reloads keep the witnessed arrival", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  let complete;
  let reload;
  let speech;
  for (const seed of [17, 99]) {
    const fresh = run({ op: "create", history: true, seed }).world;
    const reopened = run({ op: "create", save: JSON.stringify(fresh) }).world;
    for (const dry of [false, true]) {
      let world = structuredClone(reopened);
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
      const pond = run({
        ...seats,
        op: "play",
        world,
        action: "move:vale::pond",
      }).world;
      for (const sorted of [false, true]) {
        const actors = sorted
          ? Object.fromEntries(Object.entries(pond.actors).toSorted())
          : pond.actors;
        const key = dry ? "move:vale:lamp:station" : "move:vale::station";
        const request = {
          ...seats,
          op: "play",
          world: { ...pond, actors },
          action: sorted ? { key } : key,
        };
        const expected = run(request);
        const label = `${seed} dry ${dry} sorted ${sorted}`;
        assert.deepEqual(
          expected.events.map(({ actorId }) => actorId),
          seed === 17
            ? ["vale", "moth", "orin", "keeper"]
            : ["vale", "moth", "keeper"],
        );
        const settled = { ...expected.world, speechVoices: pond.speechVoices };
        complete = {
          ...seats,
          op,
          phase: "complete",
          world: settled,
          beforeSeq: pond.eventSeq,
        };
        exact(wasm(complete), expected, label);
        speech = {
          ...seats,
          op: "speech",
          room: "station",
          world: expected.world,
          lines: [
            { actorId: "vale", text: "The station is quiet." },
            { actorId: "keeper", text: "The trains are late." },
            { entityId: "station", text: "A clock ticks." },
          ],
        };
        const spoken = wasm(speech);
        exact(spoken, run(speech), `speech ${label}`);
        assert.equal(spoken.world.eventSeq, expected.world.eventSeq + 3);
        const cast = sorted
          ? ["keeper", "moth", "vale"]
          : ["vale", "moth", "keeper"];
        assert.ok(
          spoken.lines.every((line) => isDeepStrictEqual(line.cast, cast)),
          label,
        );
        const repeat = {
          ...speech,
          world: spoken.world,
          lines: [speech.lines[1]],
          present: [],
        };
        const repeated = wasm(repeat);
        exact(repeated, run(repeat), `repeat ${label}`);
        assert.deepEqual(
          repeated.world.memories.moth.learning,
          expected.world.memories.moth.learning,
        );
        for (const saved of [expected.world, spoken.world, repeated.world]) {
          for (const present of [seats.present, []]) {
            const view = { ...seats, op: "view", world: saved, present };
            reload = { ...view, op, phase: "private" };
            const actual = wasm(reload);
            exact(
              actual,
              run(view),
              `${label} published ${saved === spoken} present ${present.length}`,
            );
            assert.deepEqual(actual.world.speechVoices.vale, [
              "vale",
              "keeper",
            ]);
            assert.deepEqual(actual.world.memories.vale, saved.memories.vale);
            assert.equal(actual.world.memories.moth.learning, undefined);
            assert.ok(!Object.hasOwn(actual, "events"));
            exact(
              wasm(view),
              run(view),
              `normal view ${label} present ${present.length}`,
            );
          }
        }
      }
    }
  }
  assert.equal(wasm({ ...complete, beforeSeq: complete.beforeSeq - 1 }), null);
  assert.equal(wasm({ ...complete, present: [] }), null);
  for (const lines of [
    [{ actorId: "moth", text: "Wait for me." }],
    [speech.lines[1], speech.lines[1]],
  ]) {
    const invalid = { ...speech, lines };
    assert.equal(pinned(invalid).ok, false);
    assert.equal(wasm(invalid), null);
  }
  const wrongSeed = structuredClone(reload.world);
  wrongSeed.run.seed = 18;
  assert.equal(wasm({ ...speech, world: wrongSeed }), null);
  assert.equal(wasm({ ...reload, op: "view", world: wrongSeed }), null);
  for (const corrupt of [
    (world) => {
      world.actors.mara.place = "station";
    },
    (world) => {
      world.log.at(-1).actorId = "moth";
    },
    (world) => {
      world.log.find((entry) => entry.text === "The keeper wakes.").text =
        "The keeper sleeps.";
    },
    (world) => {
      world.log.splice(
        world.log.findIndex((entry) => entry.seq === world.arrival.seq + 1),
        1,
      );
    },
  ]) {
    const world = structuredClone(reload.world);
    corrupt(world);
    assert.equal(wasm({ ...reload, world }), null);
    assert.equal(wasm({ ...reload, op: "view", world }), null);
    assert.equal(wasm({ ...speech, world }), null);
  }
});
