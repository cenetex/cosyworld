import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function residentLoop(source) {
  const begin = "    for (const id of life) {";
  const end = "    const dawnOrDusk = s.turn % DAYLIGHT_TURNS === 0;";
  assert.equal(source.split(begin).length, 2);
  assert.equal(source.split(end).length, 2);
  return source
    .replace(
      begin,
      `    globalThis.beforeSleep = structuredClone(s);\n${begin}`,
    )
    .replace(end, `    globalThis.afterSleep = structuredClone(s);\n${end}`);
}

test("historic resident sleep preserves the pinned first settlement", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(residentLoop);
  let headedHome = 0;
  let stayedAwake = 0;
  for (const seed of [undefined, 0, 1, 17, 42, 4242, 4255, 4294967295]) {
    for (const stowed of [false, true]) {
      const fresh = pinned({ op: "create", history: true, seed });
      assert.equal(fresh.ok, true, fresh.error);
      const world = stowed
        ? pinned({
            ...seats,
            op: "hold",
            world: fresh.world,
            choice: { item: null, revision: fresh.world.revision },
          }).world
        : fresh.world;
      const play = { ...seats, world, op: "play", action: "wait:vale::" };
      const response = JSON.parse(reference.cardShared(JSON.stringify(play)));
      assert.equal(response.ok, true, response.error);
      const before = JSON.parse(JSON.stringify(reference.beforeSleep));
      const after = JSON.parse(JSON.stringify(reference.afterSleep));
      assert.equal(before.turn, 481);
      for (const id of Object.keys(after.actors)) {
        const actor = after.actors[id];
        if (!actor.sleeping) continue;
        assert.equal(actor.sleeping.since, 481);
        assert.ok(actor.sleeping.until > 481);
        assert.ok(actor.slept <= 481);
      }
      assert.ok(Object.values(after.actors).some((actor) => actor.sleeping));
      assert.equal(after.actors["greek-antigone"].sleeping, undefined);
      assert.equal(after.actors["greek-antigone"].homeward, undefined);
      if (after.actors.whiskerwind.homeward) headedHome++;
      else stayedAwake++;
      assert.deepEqual(
        wasm({ op: "opening_resident_sleep", world: before }),
        { ok: true, world: after },
        `seed ${seed}, stowed ${stowed}`,
      );
    }
  }
  assert.ok(headedHome > 0 && stayedAwake > 0);
});

test("historic pond sleep witnesses Pip after the Bard while other rooms stay silent", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(residentLoop);
  let awake = 0;
  let asleep = 0;
  for (const seed of [undefined, 2, 17, 42, 4242, 4294967295]) {
    const created = pinned({ op: "create", seed, history: true });
    assert.equal(created.ok, true, created.error);
    for (const lamp of ["stowed", "dry"]) {
      const world =
        lamp === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: created.world,
              choice: { item: null, revision: created.world.revision },
            }).world
          : structuredClone(created.world);
      if (lamp === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        world.actors = Object.fromEntries(
          Object.entries(world.actors).toSorted(),
        );
        if (world.placeCard) {
          world.placeCard = Object.fromEntries(
            Object.entries(world.placeCard).toSorted(),
          );
        }
      }
      const key = lamp === "stowed" ? "move:vale::pond" : "move:vale:lamp:pond";
      const play = { ...seats, world, op: "play", action: key };
      const response = JSON.parse(reference.cardShared(JSON.stringify(play)));
      assert.equal(response.ok, true, response.error);
      const before = JSON.parse(JSON.stringify(reference.beforeSleep));
      const after = JSON.parse(JSON.stringify(reference.afterSleep));
      assert.equal(before.log.at(-1).actorId, "greek-rhapsode");
      assert.equal(before.log.at(-1).seq, before.eventSeq);
      const added = after.log.filter((entry) => entry.seq > before.eventSeq);
      if (after.actors.moth.sleeping) {
        asleep++;
        assert.equal(added.length, 1);
        assert.equal(added[0].text, "Pip falls asleep.");
        assert.equal(added[0].actorId, "moth");
        assert.equal(added[0].locationId, "pond");
        assert.equal(added[0].seq, before.eventSeq + 1);
      } else {
        awake++;
        assert.deepEqual(added, []);
      }
      assert.deepEqual(
        wasm({ op: "opening_pond_resident_sleep", world: before }),
        { ok: true, world: after },
        JSON.stringify({ seed, lamp }),
      );
      if (seed === undefined && lamp === "stowed") {
        before.log.at(-1).actorId = "keeper";
        assert.equal(
          wasm({ op: "opening_pond_resident_sleep", world: before }),
          null,
        );
      }
    }
  }
  assert.ok(awake > 0 && asleep > 0);
});

test("historic Station settlement keeps Pip asleep at Pond and matches scheduled offstage wakes", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine((source) => {
    const wake = "    wakeSleepers(next, s, voyages);";
    assert.equal(source.split(wake).length, 2);
    return residentLoop(source).replace(
      wake,
      `    globalThis.beforeWake = structuredClone(next);\n${wake}
    globalThis.afterWake = structuredClone(next);`,
    );
  });
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  let sample;
  for (const seed of [undefined, 2, 42, 4242]) {
    const fresh = run({ op: "create", history: true, seed });
    const reopened = run({ op: "create", save: JSON.stringify(fresh) });
    const stowed = run({
      ...seats,
      op: "hold",
      world: reopened,
      choice: { item: null, revision: reopened.revision },
    });
    const pond = run({
      ...seats,
      op: "play",
      world: stowed,
      action: "move:vale::pond",
    });
    const reply = JSON.parse(
      reference.cardShared(
        JSON.stringify({
          ...seats,
          op: "play",
          world: pond,
          action: "move:vale::station",
        }),
      ),
    );
    assert.equal(reply.ok, true, reply.error);
    const captured = (key) => JSON.parse(JSON.stringify(reference[key]));
    const before = captured("beforeSleep");
    const op = "opening_station_resident_sleep";
    const after = captured("afterSleep");
    assert.equal(before.turn, 482);
    assert.equal(before.actors.moth.place, "pond");
    assert.deepEqual(after.actors.moth.sleeping, pond.actors.moth.sleeping);
    const awakened = Object.entries(before.actors).filter(
      ([id, actor]) =>
        actor.sleeping?.until === 482 && !after.actors[id].sleeping,
    );
    assert.ok(awakened.length > 0);
    assert.ok(awakened.every(([, actor]) => actor.place !== "station"));
    assert.deepEqual(
      after.actors.keeper.sleeping,
      before.actors.keeper.sleeping,
    );
    assert.equal(after.eventSeq, before.eventSeq);
    assert.deepEqual(
      wasm({ op, world: before }),
      { ok: true, world: after },
      `seed ${seed}`,
    );
    const beforeWake = captured("beforeWake");
    const afterWake = captured("afterWake");
    assert.deepEqual(afterWake, beforeWake);
    assert.deepEqual(wasm({ op: "opening_station_wake", world: beforeWake }), {
      ok: true,
      world: afterWake,
    });
    sample = { before, beforeWake };
  }
  const missingWitness = structuredClone(sample.before);
  missingWitness.log = missingWitness.log.filter(
    (event) => event.text !== "Pip falls asleep.",
  );
  assert.equal(
    wasm({ op: "opening_station_resident_sleep", world: missingWitness }),
    null,
  );
  const socialSleeper = structuredClone(sample.beforeWake);
  socialSleeper.actors.vale.sleeping = {
    since: 481,
    place: "station",
    present: [],
  };
  assert.equal(
    wasm({ op: "opening_station_wake", world: socialSleeper }),
    null,
  );
});
