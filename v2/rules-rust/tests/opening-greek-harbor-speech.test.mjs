import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const harbor = "greek-harbor";
const myrto = "greek-shipmaster";
const lines = [
  { actorId: "vale", text: "  Good to see the shore. " },
  { entityId: myrto, text: "The tides brought you here." },
  { entityId: harbor, text: "Surf washes around the quay." },
];

function exact(actual, expected, label) {
  const field = Object.keys(expected).find(
    (key) => !isDeepStrictEqual(actual?.[key], expected[key]),
  );
  assert.ok(isDeepStrictEqual(actual, expected), `${label} ${field ?? ""}`);
}

test("First Harbor speech preserves the arrival’s speakers and witnessed cast", async () => {
  const { pinned, wasm } = await reducers();
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  let sample;
  for (const [seed, sorted, priorSpeech] of [
    [undefined, false, false],
    [undefined, true, true],
    [2, false, true],
    [17, true, false],
    [4242, true, false],
  ]) {
    let { world } = run({ op: "create", seed });
    ({ world } = run({
      ...seats,
      op: "hold",
      world,
      choice: { item: null, revision: world.revision },
    }));
    for (const action of [
      "move:vale::pond",
      "move:vale::station",
      "read:vale:keeper-log:",
      "accept:vale::keeper",
      "move:vale::pond",
      "move:vale::station",
      "move:vale::pond",
    ]) {
      world = play(world, action);
    }
    if (sorted) {
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    }
    for (const action of [
      "drop:vale:lamp:pond",
      "move:vale:cloth:greek-ship",
      "course:vale::greek-harbor",
      "wait:vale::",
    ]) {
      world = play(world, action);
    }
    if (priorSpeech) {
      world = run({
        ...seats,
        op: "speech",
        world,
        room: "greek-ship",
        lines: [
          { entityId: "greek-ship", text: "The ship rests at its berth." },
        ],
      }).world;
    }
    world = play(
      world,
      sorted ? `move:vale:cloth:${harbor}` : `move:vale::${harbor}`,
    );
    assert.equal(world.turn, 11);
    assert.deepEqual(world.speechVoices.vale, ["vale", myrto]);
    const ada = seed === undefined;
    assert.equal(world.actors.ada.place === harbor, ada);
    const cast = sorted
      ? ada
        ? ["ada", myrto, "vale"]
        : [myrto, "vale"]
      : ada
        ? ["vale", myrto, "ada"]
        : ["vale", myrto];
    const label = `${seed}/${sorted}`;
    const request = { ...seats, op: "speech", world, room: harbor, lines };
    const spoken = wasm(request);
    exact(spoken, run(request), label);
    assert.equal(spoken.world.revision, world.revision + 1);
    assert.deepEqual(
      spoken.lines.map(({ speaker }) => speaker),
      ["Vale", "Myrto the Shipmaster", "The Wine-Dark Harbor"],
    );
    for (const [index, line] of spoken.lines.entries()) {
      assert.deepEqual(line.cast, cast);
      assert.equal(line.light, false);
      assert.equal(line.seq, world.eventSeq + index + 1);
      assert.equal(
        line.items.some(({ id }) => id === "ratiradio-raven-figurine"),
        seed === 17,
      );
    }
    const seq = spoken.world.eventSeq;
    assert.equal(spoken.world.memories.vale.seen[myrto].seq, seq);
    assert.equal(spoken.world.memories[myrto].seen.vale.seq, seq);
    if (ada) {
      assert.equal(spoken.world.memories.ada.seen.vale.seq, seq);
      const uncalled = {
        ...request,
        lines: [{ actorId: "ada", text: "We made it." }],
      };
      assert.equal(pinned(uncalled).ok, false);
      assert.equal(wasm(uncalled), null);
    }
    const away = {
      ...request,
      present: [],
      world: spoken.world,
      lines: lines.slice(-1),
    };
    delete away.room;
    const caption = wasm(away);
    exact(caption, run(away), `${label} away`);
    const released = {
      ...away,
      claimed: [],
      world: caption.world,
      lines: lines.slice(0, -1),
    };
    const final = wasm(released);
    exact(final, run(released), `${label} released`);
    for (const present of [seats.present, []]) {
      const view = { ...seats, op: "view", world: final.world, present };
      exact(wasm(view), run(view), `${label} private ${present}`);
    }
    sample = { ...request, world: final.world };
  }
  for (const invalid of [
    { ...sample, claimed: [] },
    { ...sample, actor: myrto },
    { ...sample, room: "greek-ship" },
    { ...sample, lines: [lines[0], lines[0]] },
  ]) {
    assert.equal(pinned(invalid).ok, false);
    assert.equal(wasm(invalid), null);
  }
  const forged = structuredClone(sample.world);
  forged.log.at(-1).speaker = "Sage";
  assert.equal(wasm({ ...sample, world: forged }), null);
});
