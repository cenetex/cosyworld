import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_second_attic_wants";

function capture(source) {
  const start = "    reviseStalledWants(\n      next,";
  const end = "    fillWants(next, wantAPI(next));";
  assert.equal(source.split(start).length, 2);
  assert.equal(source.split(end).length, 2);
  return source
    .replace(start, "    globalThis.beforeWants = structuredClone(next);\n$&")
    .replace(end, "$&\n    globalThis.afterWants = structuredClone(next);");
}

test("a second attic Wait or Take settles wants exactly when residents stay or move", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capture);
  let moved = false;
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    const { world } = pinned({ op: "create", seed });
    for (const [first, second] of [
      ["wait:vale::", "wait:vale::"],
      ["drop:vale:lamp:attic", "take:vale:lamp:"],
    ]) {
      const prior = pinned({ ...seats, op: "play", world, action: first });
      assert.equal(prior.ok, true, prior.error);
      const reply = JSON.parse(
        reference.cardShared(
          JSON.stringify({
            ...seats,
            op: "play",
            world: prior.world,
            action: second,
          }),
        ),
      );
      assert.equal(reply.ok, true, reply.error);
      moved ||= reply.events.some(
        ({ actorId, verb }) => actorId !== "vale" && verb === "move",
      );
      const before = JSON.parse(JSON.stringify(reference.beforeWants));
      const after = JSON.parse(JSON.stringify(reference.afterWants));
      const actual = wasm({ op, world: before });
      assert.ok(actual, `${seed} ${second}`);
      const changed = Object.keys(after).find(
        (key) => !isDeepStrictEqual(actual.world[key], after[key]),
      );
      assert.equal(changed, undefined, `${seed} ${second}`);
      assert.deepEqual(
        Object.keys(actual.world).sort(),
        Object.keys(after).sort(),
      );

      before.heldActors.push("mara");
      assert.equal(wasm({ op, world: before }), null);
    }
  }
  assert.ok(moved);
});

test("the second pond arrival settles wants after Pip's refusal", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capture);
  const pond = "opening_second_pond_wants";
  for (const seed of [undefined, 2, 17, 4242, 4294967295]) {
    for (const mode of ["stowed", "held dry"]) {
      let { world } = pinned({ op: "create", seed });
      if (mode === "stowed") {
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
      const prior = pinned({
        ...seats,
        op: "play",
        world,
        action: "wait:vale::",
      });
      assert.equal(prior.ok, true, prior.error);
      for (const action of ["move:vale::pond", "move:vale:lamp:pond"]) {
        const play = { ...seats, op: "play", world: prior.world, action };
        const reply = JSON.parse(reference.cardShared(JSON.stringify(play)));
        assert.equal(reply.ok, true, reply.error);
        const before = JSON.parse(JSON.stringify(reference.beforeWants));
        const after = JSON.parse(JSON.stringify(reference.afterWants));
        const actual = wasm({ op: pond, world: before });
        const label = `${seed} ${mode} ${action}`;
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: after }), label);
        before.actors.moth.want.refusals = 2;
        assert.equal(wasm({ op: pond, world: before }), null);
      }
    }
  }
});

test("quiet Station arrivals settle wants on either opening turn", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capture);
  const op = "opening_station_wants";
  const play = (world, action) => {
    const reply = pinned({ ...seats, op: "play", world, action });
    assert.equal(reply.ok, true, reply.error);
    return reply.world;
  };
  for (const seed of [undefined, 0, 2, 7, 17, 4242, 4294967295]) {
    for (const waited of [false, true]) {
      for (const carry of [false, true]) {
        let { world } = pinned({ op: "create", seed });
        if (carry) {
          Object.assign(world.items.lamp, {
            fuel: 0,
            fuelRooms: 0,
            lit: false,
          });
        } else {
          const reply = pinned({
            ...seats,
            op: "hold",
            world,
            choice: { item: null, revision: world.revision },
          });
          assert.equal(reply.ok, true, reply.error);
          world = reply.world;
        }
        if (waited) world = play(world, "wait:vale::");
        world = play(world, "move:vale::pond");
        const action = carry ? "move:vale:lamp:station" : "move:vale::station";
        const reply = JSON.parse(
          reference.cardShared(
            JSON.stringify({
              ...seats,
              op: "play",
              world,
              action,
            }),
          ),
        );
        const label = `${seed} ${action} ${waited ? "third turn" : "second turn"}`;
        assert.equal(reply.ok, true, reply.error);
        const before = JSON.parse(JSON.stringify(reference.beforeWants));
        const after = JSON.parse(JSON.stringify(reference.afterWants));
        assert.ok(
          isDeepStrictEqual(wasm({ op, world: before }), {
            ok: true,
            world: after,
          }),
          label,
        );
        before.actors.moth.want.refusals = 2;
        assert.equal(wasm({ op, world: before }), null);
      }
    }
  }
});

test("historic Station arrival settles wants and contacts while Pip sleeps at Pond", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capture);
  const op = "opening_station_wants";
  const sort = (map) => Object.fromEntries(Object.entries(map).toSorted());
  let valid;
  for (const seed of [undefined, 2, 42, 4242]) {
    const created = pinned({ op: "create", history: true, seed });
    assert.equal(created.ok, true, created.error);
    for (const mode of ["stowed", "dry"]) {
      let world = structuredClone(created.world);
      if (mode === "stowed") {
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
      const pond = pinned({
        ...seats,
        op: "play",
        world,
        action: "move:vale::pond",
      });
      assert.equal(pond.ok, true, pond.error);
      assert.equal(pond.world.actors.moth.sleeping.since, 481);
      const sorted = {
        ...pond.world,
        actors: sort(pond.world.actors),
        ...(pond.world.placeCard && { placeCard: sort(pond.world.placeCard) }),
      };
      for (const [order, world] of [
        ["authored", pond.world],
        ["sorted", sorted],
      ]) {
        const action =
          mode === "dry" ? "move:vale:lamp:station" : "move:vale::station";
        const reply = JSON.parse(
          reference.cardShared(
            JSON.stringify({ ...seats, op: "play", world, action }),
          ),
        );
        assert.equal(reply.ok, true, reply.error);
        const before = JSON.parse(JSON.stringify(reference.beforeWants));
        const after = JSON.parse(JSON.stringify(reference.afterWants));
        const label = `${seed} ${mode} ${order}`;
        const actual = wasm({ op, world: before });
        assert.ok(actual, `unsupported ${label}`);
        const changed = Object.keys(after).find(
          (field) => !isDeepStrictEqual(actual.world[field], after[field]),
        );
        assert.equal(changed, undefined, label);
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: after }), label);
        assert.equal(after.actors["greek-aethra"].want.since, 482);
        assert.notDeepEqual(
          after.actors.rati.contact,
          before.actors.rati.contact,
        );
        assert.deepEqual(after.actors.moth, before.actors.moth);
        valid = before;
      }
    }
  }
  assert.ok(valid);
  for (const corrupt of [
    (world) => {
      world.arrival.fromLocationId = "attic";
    },
    (world) => {
      delete world.actors.moth.sleeping;
    },
    (world) => {
      world.actors.moth.sleeping.until = world.turn;
    },
    (world) => {
      world.log = world.log.filter(
        (event) =>
          event.turn !== 481 ||
          event.actorId !== "moth" ||
          event.kind !== "narration",
      );
    },
    (world) => {
      world.actors.moth.want.refusals = 2;
    },
    (world) => {
      world.actors["greek-adrastus"].want.refusals = 1;
    },
    (world) => {
      world.heldActors.push("mara");
    },
  ]) {
    const world = structuredClone(valid);
    corrupt(world);
    assert.equal(wasm({ op, world }), null);
  }
});
