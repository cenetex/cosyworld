import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const lines = [
  { actorId: "vale", text: "  This is where I can signal. " },
  { entityId: "pond", text: "The water holds the sky." },
];

function exact(actual, expected, label) {
  const field = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.ok(isDeepStrictEqual(actual, expected), `${label} ${field ?? ""}`);
}

test("Pond speech and reloads follow the Keeper quest return and ship call", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  for (const [seed, dry, sorted, returnWithCloth] of [
    [0, false, true, "move:vale:lamp:pond"],
    [2, false, false, "move:vale:cloth:pond"],
    [17, true, true, "move:vale:cloth:pond"],
    [42, true, false, "move:vale::pond"],
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
    for (const action of [
      "move:vale::pond",
      "move:vale::station",
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
      returnWithCloth,
    ]) {
      if (sorted) {
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      }
      ({ world } = run({ ...seats, op: "play", action, world }));
    }
    assert.equal(world.turn, 6);
    const saves = [world];
    if (!dry) {
      const called = run({
        ...seats,
        op: "play",
        action: "drop:vale:lamp:pond",
        world,
      });
      assert.equal(called.world.turn, 7);
      assert.equal(called.world.transports["greek-ship"].dock, "pond");
      saves.push(called.world);
    }
    for (const saved of saves) {
      const label = `${seed} turn ${saved.turn}`;
      assert.deepEqual(saved.speechVoices.vale, ["vale"]);
      const speech = {
        ...seats,
        op: "speech",
        room: "pond",
        world: saved,
        lines,
        entries: [],
      };
      const expected = run(speech);
      const published = wasm(speech);
      exact(published, expected, label);
      assert.equal(published.world.revision, saved.revision + 1);
      assert.deepEqual(published.world.speechVoices.vale, ["vale"]);
      assert.deepEqual(
        published.lines.map(({ kind }) => kind),
        ["dialogue", "narration"],
      );
      assert.ok(
        published.lines.every(
          ({ light, cast }) =>
            light === (saved.turn === 7) && isDeepStrictEqual(cast, ["vale"]),
        ),
      );
      const afterRelease = {
        ...speech,
        claimed: [],
        present: [],
        world: published.world,
        lines: lines.slice(1),
      };
      delete afterRelease.room;
      const repeated = wasm(afterRelease);
      exact(repeated, run(afterRelease), `${label} released scenery`);
      const voiceAfterRelease = { ...afterRelease, lines: lines.slice(0, 1) };
      exact(
        wasm(voiceAfterRelease),
        run(voiceAfterRelease),
        `${label} released voice`,
      );
      const left = { ...speech, present: [], world: repeated.world };
      exact(wasm(left), run(left), `${label} left`);
      for (const present of [seats.present, []]) {
        const view = { ...seats, op: "view", world: repeated.world, present };
        exact(wasm(view), run(view), `${label} reload ${present}`);
      }
      if (saved.turn === 6 && !dry) {
        const drop = {
          ...seats,
          op: "play",
          action: "drop:vale:lamp:pond",
          world: repeated.world,
          revision: repeated.world.revision,
        };
        const called = wasm(drop);
        exact(called, run(drop), `${label} drop after captions`);
        assert.equal(called.events[0].seq, repeated.world.eventSeq + 1);
        assert.equal(called.world.transports["greek-ship"].dock, "pond");
        const nextSpeech = { ...speech, world: called.world };
        const described = wasm(nextSpeech);
        exact(described, run(nextSpeech), `${label} speech after call`);
        const reload = {
          ...seats,
          present: [],
          op: "view",
          world: described.world,
        };
        exact(wasm(reload), run(reload), `${label} reload after call`);
        const unwitnessed = structuredClone(drop.world);
        unwitnessed.log.at(-1).locationId = "station";
        assert.equal(wasm({ ...drop, world: unwitnessed }), null);
      }
      for (const invalid of [
        { ...speech, claimed: [] },
        { ...speech, room: "station" },
        { ...speech, lines: [lines[0], lines[0]] },
        { ...speech, lines: [{ actorId: "moth", text: "Wait for me." }] },
        { ...speech, lines: [{ actorId: "vale", text: "\n" }] },
      ]) {
        assert.equal(pinned(invalid).ok, false, `${label} refusal`);
        assert.equal(wasm(invalid), null);
      }
      const forged = structuredClone(published.world);
      forged.log.at(-1).entityId = "station";
      assert.equal(wasm({ ...speech, world: forged }), null);
    }
  }
});
