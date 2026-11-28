import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function captureVisitorPlays(source) {
  const boundary =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `      const action = read2 ?? plan(next, id).action;
      const observe =
        unplayedAvatar(next, id) &&
        (next.turn === 2 || (exact.kind === "move" && exact.target === "station"));
      const before = observe ? structuredClone(next) : null;
      perform(next, action, round2, residents2);
      if (observe) globalThis.visitorPlays.push({
        actor: id, action, before, after: structuredClone(next),
      });`,
  );
}

test("second visitor actions preserve pinned quiet arrivals and complete home departures", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureVisitorPlays);
  const counts = { move: 0, wait: 0 };
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    const created = pinned({ op: "create", seed });
    assert.equal(created.ok, true, created.error);
    for (const [first, second] of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const started = pinned({
        ...seats,
        op: "play",
        world: created.world,
        action: first,
      });
      assert.equal(started.ok, true, started.error);
      reference.visitorPlays = [];
      const completed = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: started.world,
            action: second,
          }),
        ),
      );
      assert.equal(completed.ok, true, completed.error);
      const observed = JSON.parse(JSON.stringify(reference.visitorPlays));
      assert.equal(observed.length, 7);
      for (const { actor, action, before, after } of observed) {
        const actual = wasm({
          op: "opening_visitor_play",
          world: before,
          actor,
        });
        const label = JSON.stringify({
          seed,
          second,
          actor,
          action: action.key,
        });
        assert.ok(actual, `unsupported ${label}`);
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: after }), label);
        if (action.kind === "wait") {
          assert.ok(isDeepStrictEqual(after, before), label);
          counts.wait++;
        } else {
          assert.equal(action.kind, "move");
          const event = after.log.at(-1);
          const [, item] = event.witnesses;
          assert.equal(after.items[item].holder, event.fromLocationId);
          assert.deepEqual(
            after.items[item].history,
            before.items[item].history,
          );
          assert.equal(after.actors[actor].heldItem, null);
          assert.equal(
            after.crossings[`${event.fromLocationId}-${event.locationId}`]
              .discovered,
            true,
          );
          counts.move++;
        }
      }
    }
  }
  assert.deepEqual(counts, { move: 6, wait: 64 });
});

test("visitor actions after the second pond crossing match pinned working states", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureVisitorPlays);
  const counts = { move: 0, wait: 0 };
  let request;
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const lamp of ["stowed", "held dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (lamp === "stowed") {
        const held = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        });
        assert.equal(held.ok, true, held.error);
        world = held.world;
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      const first = pinned({
        ...seats,
        op: "play",
        world,
        action: "wait:vale::",
      });
      assert.equal(first.ok, true, first.error);
      for (const key of ["move:vale::pond", "move:vale:lamp:pond"]) {
        reference.visitorPlays = [];
        const moved = JSON.parse(
          reference.cardShared(
            JSON.stringify({
              ...seats,
              op: "play",
              world: first.world,
              action: key,
            }),
          ),
        );
        assert.equal(moved.ok, true, moved.error);
        const observed = JSON.parse(JSON.stringify(reference.visitorPlays));
        assert.equal(observed.length, 7);
        for (const { actor, action, before, after } of observed) {
          request = { op: "opening_visitor_play", actor, world: before };
          const actual = wasm(request);
          const label = `${seed} ${lamp} ${key} ${action.key}`;
          assert.ok(
            isDeepStrictEqual(actual, { ok: true, world: after }),
            label,
          );
          assert.ok(action.kind in counts, label);
          counts[action.kind]++;
        }
      }
    }
  }
  assert.deepEqual(counts, { move: 12, wait: 128 });
  const forged = structuredClone(request.world);
  forged.arrival.fromLocationId = "station";
  assert.equal(wasm({ ...request, world: forged }), null);
});

test("first Station arrivals replay quiet at-home visitor plays", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureVisitorPlays);
  const counts = {
    wait: 0,
    move: 0,
    station: 0,
    awayWait: 0,
    awayTalk: 0,
    afterTalk: 0,
  };
  function play(world, action, reducer = pinned) {
    const result = reducer({ ...seats, op: "play", world, action });
    assert.equal(result.ok, true, result.error);
    return result.world;
  }

  let verified;
  for (const seed of [undefined, 2, 5, 7, 17, 99, 4242, 4_294_967_295]) {
    for (const mode of ["stowed", "dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
        ({ world } = pinned({
          ...seats,
          op: "hold",
          world,
          choice: { item: null, revision: world.revision },
        }));
      } else {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      }
      for (const waited of [false, true]) {
        const start = waited ? play(world, "wait:vale::") : world;
        const pond = play(start, "move:vale::pond");
        const key =
          waited === (mode === "stowed")
            ? "move:vale:lamp:station"
            : "move:vale::station";
        reference.visitorPlays = [];
        play(pond, key, (request) =>
          JSON.parse(reference.cardShared(JSON.stringify(request))),
        );
        const observed = JSON.parse(JSON.stringify(reference.visitorPlays));
        assert.equal(observed.length, 7);
        for (const { actor, action, before, after } of observed) {
          const request = { op: "opening_visitor_play", actor, world: before };
          const label = `${seed} ${mode} ${before.turn} ${action.key}`;
          const actual = wasm(request);
          if (before.actors[actor].crossed !== 0) {
            assert.equal(actual, null, label);
            assert.ok(["wait", "talk"].includes(action.kind), label);
            counts[action.kind === "wait" ? "awayWait" : "awayTalk"]++;
          } else if (action.key === `move:${actor}::station`) {
            assert.equal(actual, null, label);
            counts.station++;
          } else if (before.conversations.length) {
            assert.equal(actual, null, label);
            assert.equal(action.kind, "wait", label);
            counts.afterTalk++;
          } else {
            assert.ok(actual, `unsupported ${label}`);
            assert.ok(
              isDeepStrictEqual(actual, { ok: true, world: after }),
              label,
            );
            assert.ok(["move", "wait"].includes(action.kind), label);
            counts[action.kind]++;
            if (seed === undefined && waited) verified = request;
          }
        }
      }
    }
  }
  assert.deepEqual(counts, {
    wait: 188,
    move: 10,
    station: 4,
    awayWait: 10,
    awayTalk: 4,
    afterTalk: 8,
  });
  assert.ok(verified);
  for (const corrupt of [
    (world) => {
      world.arrival.fromLocationId = "attic";
    },
    (world) => {
      world.arrival.seq--;
    },
    (world) => {
      world.log.find(
        (event) => event.actorId === "vale" && event.turn === 1,
      ).sleep = true;
    },
    (world) => {
      world.log.find(
        (event) => event.actorId === "vale" && event.turn === 2,
      ).fromLocationId = "clearing";
    },
  ]) {
    const world = structuredClone(verified.world);
    corrupt(world);
    assert.equal(wasm({ ...verified, world }), null);
  }
});
