import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

test("quiet Station arrival preserves the wire order of private offers", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const success = (request) => {
    const response = pinned(request);
    assert.equal(response.ok, true, response.error);
    return response;
  };
  let { world } = success({ op: "create", seed: 2 });
  ({ world } = success({
    ...seats,
    op: "hold",
    world,
    choice: { item: null, revision: world.revision },
  }));
  for (const action of ["move:vale::pond", "move:vale:lamp:station"]) {
    ({ world } = success({ ...seats, op: "play", world, action }));
  }
  const rosters = [
    world.actors,
    Object.fromEntries(Object.entries(world.actors).sort()),
  ];
  for (const actors of rosters) {
    const request = { ...seats, op: "view", world: { ...world, actors } };
    const response = wasm(request);
    assert.deepEqual(response, success(request));
    assert.deepEqual(response.world.speechVoices.vale, ["vale", "keeper"]);
    assert.equal(response.world.memories.keeper.subjects, undefined);
    assert.deepEqual(response.world.memories.vale, world.memories.vale);
    assert.ok(
      response.actions.some(({ key }) => key === "accept:vale::box:train"),
    );
    assert.ok(
      response.actions.some(
        ({ key }) => key === "take:vale:elysium-wayfinder:",
      ),
    );
  }
});

test("seated Station reloads keep Rue, offers and the published speech", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let last;
  for (const seed of [73, 75]) {
    for (const lamp of ["stowed", "dry"]) {
      let world = run({ op: "create", seed });
      if (lamp === "stowed") {
        world = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      world = run({ ...seats, op: "play", world, action: "move:vale::pond" });
      for (const sorted of [false, true]) {
        const actors = sorted
          ? Object.fromEntries(Object.entries(world.actors).toSorted())
          : world.actors;
        const action = sorted ? "move:vale:lamp:station" : "move:vale::station";
        const arrived = run({
          ...seats,
          op: "play",
          world: { ...world, actors },
          action,
        });
        assert.equal(wasm({
          ...seats, op: "play", world: arrived, action: "accept:vale::box:train",
        }), null);
        const spoken = run({
          ...seats,
          op: "speech",
          world: arrived,
          room: "station",
          lines: [
            { actorId: "vale", text: "The station is quiet." },
            { actorId: "rue", text: "I have been waiting." },
            { actorId: "keeper", text: "The trains are late." },
            { entityId: "station", text: "A latch rattles." },
          ],
        });
        assert.equal(spoken.eventSeq, arrived.eventSeq + 4);
        for (const persisted of [arrived, spoken]) {
          last = { ...seats, op: "view", world: persisted };
          const label = `${seed} ${lamp} ${action} published ${persisted === spoken}`;
          const expected = pinned(last);
          assert.equal(expected.ok, true, expected.error);
          const actual = wasm(last);
          assert.ok(actual, label);
          const different = Object.keys(expected).find(
            (key) => !isDeepStrictEqual(expected[key], actual[key]),
          );
          assert.ok(
            isDeepStrictEqual(actual, expected),
            `${label} ${different ?? "extra fields"}`,
          );
          assert.equal(actual.profiles.rue.kind, "avatar");
          assert.deepEqual(actual.world.speechVoices.vale, [
            "vale",
            "keeper",
            "rue",
          ]);
          assert.deepEqual(actual.world.memories.vale, persisted.memories.vale);
          assert.equal(actual.world.memories.rue.subjects, undefined);
          assert.ok(!Object.hasOwn(actual, "events"));
        }
      }
    }
  }
  assert.equal(wasm({ ...last, present: [] }), null);
  for (const corrupt of [
    (world) => {
      world.packs["shared-homes"].met.rue = 1;
    },
    (world) => {
      world.log.find(
        (event) => event.verb === "move" && event.actorId === "rue",
      ).fromLocationId = "clearing";
    },
    (world) => {
      world.log.at(-1).actorId = "moth";
    },
  ]) {
    const world = structuredClone(last.world);
    corrupt(world);
    assert.equal(wasm({ ...last, world }), null);
  }
});

test("historic Station reloads preserve sleeping residents and available offers", async () => {
  const { pinned, wasm } = await reducers();
  const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let last;
  for (const seed of [undefined, 2, 42, 4242]) {
    for (const dry of [false, true]) {
      let world = run({ op: "create", seed, history: true });
      if (dry) {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
      } else {
        world = run({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
      }
      world = run({ ...seats, op: "play", world, action: "move:vale::pond" });
      const action = dry ? "move:vale:lamp:station" : "move:vale::station";
      const arrived = run({ ...seats, op: "play", world, action });
      const spoken = run({
        ...seats,
        op: "speech",
        world: arrived,
        room: "station",
        lines: [
          { actorId: "vale", text: "The station is quiet." },
          { actorId: "keeper", text: "A train will come." },
          { entityId: "station", text: "A clock ticks." },
        ],
      });
      assert.equal(spoken.eventSeq, arrived.eventSeq + 3);
      for (const saved of [arrived, spoken]) {
        for (const present of [seats.present, []]) {
          last = { ...seats, present, op: "view", world: saved };
          const expected = pinned(last);
          assert.equal(expected.ok, true, expected.error);
          const actual = wasm(last);
          const label = `${seed} dry ${dry} present ${present.length} published ${saved === spoken}`;
          assert.ok(actual, label);
          const differing = Object.keys(expected).find(
            (key) => !isDeepStrictEqual(expected[key], actual[key]),
          );
          assert.ok(
            isDeepStrictEqual(actual, expected),
            `${label} ${differing ?? "extra fields"}`,
          );
          assert.deepEqual(actual.world.speechVoices.vale, ["vale", "keeper"]);
          assert.deepEqual(actual.world.memories.vale, saved.memories.vale);
          assert.equal(actual.world.memories.keeper.subjects, undefined);
          assert.ok(actual.actions.every((action) => action.target !== "moth"));
          assert.equal(
            actual.actions.some(({ kind }) => kind === "accompany"),
            seed !== 4242,
          );
          assert.equal(
            actual.actions.some(({ kind }) => kind === "ask"),
            seed !== 4242,
          );
          assert.equal(
            actual.actions.some(({ kind }) => kind === "trade"),
            seed !== 4242,
          );
          assert.ok(
            actual.actions.some(({ key }) => key === "give:vale:lamp:keeper"),
          );
          assert.ok(!Object.hasOwn(actual, "events"));
        }
      }
    }
  }
  for (const change of [
    (world) => {
      world.actors.moth.sleeping.until = 482;
    },
    (world) => {
      world.log.find((event) => event.text === "Pip falls asleep.").generated =
        true;
    },
    (world) => {
      world.actors.keeper.sleeping.place = "pond";
    },
  ]) {
    const world = structuredClone(last.world);
    change(world);
    assert.equal(wasm({ ...last, world }), null);
  }
});
