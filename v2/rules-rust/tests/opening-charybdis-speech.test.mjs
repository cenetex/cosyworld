import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const ship = "greek-ship";

function exact(actual, expected, label) {
  const field = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.ok(isDeepStrictEqual(actual, expected), `${label} ${field ?? ""}`);
}

test("First Charybdis speech is restricted to the witnessed ship scene", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const [seed, sorted, shoreSpeech] of [
    [undefined, false, false],
    [undefined, true, true],
    [2, false, false],
    [17, true, true],
    [4242, true, false],
  ]) {
    let world = run({ op: "create", seed });
    world = run({
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    });
    for (const action of [
      "move:vale::pond",
      "move:vale::station",
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
      "move:vale::pond",
    ]) {
      world = run({ ...seats, op: "play", action, world });
    }
    if (sorted) {
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    }
    world = run({ ...seats, op: "play", action: "drop:vale:lamp:pond", world });
    if (shoreSpeech) {
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "pond",
        lines: [{ entityId: "pond", text: "The ship settles at the shore." }],
      });
    }
    const action = sorted ? `move:vale:cloth:${ship}` : `move:vale::${ship}`;
    const saved = run({ ...seats, op: "play", action, world });
    const ada = seed === undefined;
    assert.equal(saved.turn, 8);
    assert.deepEqual(saved.speechVoices.vale, ada ? ["vale", "ada"] : ["vale"]);
    const lines = [
      { actorId: "vale", text: "  The deck feels quiet. " },
      ...(ada ? [{ entityId: "ada", text: "The water carries us." }] : []),
      { entityId: ship, text: "The hull creaks softly." },
    ];
    const label = `${seed}/${sorted}`;
    const request = { ...seats, op: "speech", world: saved, room: ship, lines };
    const spoken = wasm(request);
    exact(spoken, pinned(request), label);
    assert.equal(spoken.world.revision, saved.revision + 1);
    assert.deepEqual(
      spoken.lines.map(({ speaker }) => speaker),
      ada ? ["Vale", "Sage", "The Charybdis"] : ["Vale", "The Charybdis"],
    );
    const cast = ada ? (sorted ? ["ada", "vale"] : ["vale", "ada"]) : ["vale"];
    for (const [index, line] of spoken.lines.entries()) {
      assert.deepEqual(line.cast, cast);
      assert.equal(line.light, false);
      assert.equal(line.seq, saved.eventSeq + index + 1);
    }
    if (ada) {
      const seq = spoken.world.eventSeq;
      assert.equal(spoken.world.memories.vale.seen.ada.seq, seq);
      assert.equal(spoken.world.memories.ada.seen.vale.seq, seq);
      assert.deepEqual(
        spoken.world.memories.vale.subjects,
        saved.memories.vale.subjects,
      );
    }
    const away = {
      ...request,
      world: spoken.world,
      present: [],
      lines: lines.slice(-1),
    };
    delete away.room;
    const caption = wasm(away);
    exact(caption, pinned(away), `${label} away`);
    const released = {
      ...away,
      world: caption.world,
      claimed: [],
      lines: lines.slice(0, -1),
    };
    const final = wasm(released);
    exact(final, pinned(released), `${label} released`);
    for (const present of [seats.present, []]) {
      const view = { ...seats, op: "view", world: final.world, present };
      exact(wasm(view), pinned(view), `${label} view ${present}`);
    }
    sample = { ...request, world: final.world };
  }
  for (const invalid of [
    { ...sample, claimed: [] },
    { ...sample, room: "pond" },
    { ...sample, lines: [{ actorId: "ada", text: "The ship waits." }] },
    { ...sample, lines: [sample.lines[0], sample.lines[0]] },
  ]) {
    assert.equal(pinned(invalid).ok, false);
    assert.equal(wasm(invalid), null);
  }
  const forged = structuredClone(sample.world);
  forged.log.at(-1).locationId = "pond";
  assert.equal(wasm({ ...sample, world: forged }), null);
});
