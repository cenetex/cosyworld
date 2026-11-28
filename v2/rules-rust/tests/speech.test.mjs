import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seat = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const caption = {
  entityId: "attic",
  actorId: null,
  text: "\uFEFFWind nudges the shutters. ",
};
const speech = { entityId: "vale", actorId: "vale", text: "I hear the wind." };

function waitInAttic(pinned, seed, history) {
  const created = pinned({ op: "create", seed, history });
  const joined = pinned({
    op: "join",
    actor: "vale",
    claimed: [],
    present: [],
    world: created.world,
  });
  const waited = pinned({
    ...seat,
    op: "play",
    world: joined.world,
    action: "wait:vale::",
  });
  assert.equal(waited.ok, true, waited.error);
  assert.deepEqual(waited.world.speechVoices.vale, ["vale"]);
  return waited.world;
}

function exchange(world, lines = [speech, caption]) {
  return { ...seat, op: "speech", world, room: "attic", entries: [], lines };
}

test("opening speech records the named voices, sequence, cast, and memories", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [0, 17, 4242]) {
    let world = waitInAttic(pinned, seed);
    if (seed === 17) {
      const held = pinned({
        ...seat,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
      assert.equal(held.ok, true, held.error);
      world = held.world;
    }
    const request = {
      ...exchange(world),
      ...(seed === 4242 && { present: [] }),
    };
    const expected = pinned(request);
    assert.equal(expected.ok, true, expected.error);
    const actual = wasm(request);
    assert.ok(actual, `missing speech support for seed ${seed}`);
    assert.deepEqual(actual.lines, expected.lines);
    for (const id of ["attic", "vale", "lamp"]) {
      assert.deepEqual(actual.world.memories[id], expected.world.memories[id]);
    }
    assert.equal(actual.world.revision, world.revision + 1);
    assert.equal(actual.world.turn, world.turn);
    assert.deepEqual(actual.world, expected.world);
  }
});

test("the historic first Wait publishes both voices with the Wayfinder at the station", async () => {
  const { pinned, wasm } = await reducers();
  const waited = waitInAttic(pinned, 42, true);
  assert.equal(waited.turn, 481);
  assert.equal(waited.items["elysium-wayfinder"].holder, "station");
  assert.deepEqual(waited.placeMet.station, ["elysium-wayfinder"]);
  for (const stowed of [false, true]) {
    let world = waited;
    if (stowed) {
      const held = pinned({
        ...seat,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      });
      assert.equal(held.ok, true, held.error);
      world = held.world;
    }
    for (const present of [seat.present, []]) {
      const request = { ...exchange(world), present };
      const expected = pinned(request);
      assert.equal(expected.ok, true, expected.error);
      assert.equal(expected.lines[0].light, !stowed);
      assert.deepEqual(wasm(request), expected);
      const repeat = { ...exchange(expected.world, [caption]), present };
      assert.deepEqual(wasm(repeat), pinned(repeat));
    }
  }
  const other = structuredClone(waited);
  other.log.find((entry) => entry.verb === "wait").sleep = true;
  assert.equal(wasm(exchange(other)), null);
});

test("speech after the first Drop uses the grounded lamp and keeps the committed events", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 17, 42]) {
    for (const lamp of ["held", "stowed", "dry"]) {
      const created = pinned({ op: "create", seed });
      assert.equal(created.ok, true, created.error);
      let { world } = created;
      if (lamp === "stowed") {
        const held = pinned({
          ...seat,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(held.ok, true, held.error);
        world = held.world;
      }
      if (lamp === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      const dropped = pinned({
        ...seat,
        op: "play",
        world,
        action: "drop:vale:lamp:attic",
      });
      assert.equal(dropped.ok, true, dropped.error);
      assert.deepEqual(dropped.world.speechVoices.vale, ["vale"]);
      assert.equal(
        dropped.events.some(
          (entry) =>
            entry.text === "The attic mirror's path to the pond closes.",
        ),
        lamp === "stowed",
      );
      for (const present of [seat.present, []]) {
        const request = { ...exchange(dropped.world), present };
        const expected = pinned(request);
        assert.equal(expected.ok, true, expected.error);
        const actual = wasm(request);
        assert.deepEqual(
          actual,
          expected,
          `seed ${seed}, lamp ${lamp}, present ${present}`,
        );
        assert.deepEqual(
          actual.lines.map((line) => line.entityId),
          ["vale", "attic"],
        );
        for (const line of actual.lines) {
          assert.deepEqual(
            line.items.map((item) => [item.id, item.holder]),
            [["lamp", "attic"]],
          );
          assert.equal(line.light, lamp !== "dry");
        }
        assert.deepEqual(
          actual.world.log.filter((entry) => !entry.generated),
          dropped.world.log,
        );
        const repeat = { ...exchange(actual.world, [caption]), present };
        assert.deepEqual(wasm(repeat), pinned(repeat));
      }
      const other = structuredClone(dropped.world);
      other.log.find((entry) => entry.verb === "drop").itemId = "cloth";
      assert.equal(wasm(exchange(other)), null);
    }
  }
});

test("generated speech keeps its own retention window", async () => {
  const { pinned, wasm } = await reducers();
  const world = waitInAttic(pinned, 19);
  const { lines } = pinned(exchange(world, [caption]));
  assert.equal(lines.length, 1);
  for (let count = 0; count < 100; count++) {
    world.log.push({ ...lines[0], seq: ++world.eventSeq });
  }
  for (const id of ["attic", "vale", "lamp"]) {
    world.memories[id].events = world.log
      .slice(-16)
      .map(({ seq, turn, speaker, text }) => ({
        seq,
        turn,
        kind: "expression",
        text: `${speaker}: ${text}`,
      }));
  }
  const authoritative = world.log.filter((entry) => !entry.generated);
  const request = exchange(world);
  const expected = pinned(request);
  assert.equal(expected.ok, true, expected.error);
  const actual = wasm(request);
  assert.ok(actual);
  assert.deepEqual(
    actual.world.log.filter((entry) => !entry.generated),
    authoritative,
  );
  assert.equal(actual.world.log.filter((entry) => entry.generated).length, 100);
  assert.deepEqual(actual, expected);
});

test("speech declines unsupported reflection, disclosure, and multi-actor scenes", async () => {
  const { pinned, wasm } = await reducers();
  const world = waitInAttic(pinned, 19);
  const request = exchange(world);
  const company = structuredClone(world);
  company.actors.moth.place = "attic";
  const covering = structuredClone(world);
  covering.items.cloth.holder = "lamp";
  for (const changes of [
    { world: company },
    { world: covering },
    { lines: [{ ...speech, disclosed: "fact" }] },
    { lines: [caption, caption] },
    { lines: [speech, { ...caption, elysiumName: null }] },
    { entries: [{ id: "vale", reflection: { thought: "I am listening." } }] },
  ]) {
    assert.equal(wasm({ ...request, ...changes }), null);
  }
});
