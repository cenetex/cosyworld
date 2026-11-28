import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::pond", "move:vale:lamp:pond"];

function captureMove(source) {
  const boundary = "    const sourceSeq = event.seq;";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `${boundary}
    if (a.actor === "vale" && a.kind === "move") {
      globalThis.primaryMove = structuredClone(s);
    }`,
  );
}

test("first mirror travel matches the pinned arrival and its action evidence", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureMove);
  for (const history of [false, true]) {
    for (const seed of [undefined, 4242, 4294967295]) {
      const fresh = pinned({ op: "create", history, seed });
      assert.equal(fresh.ok, true, fresh.error);
      for (const lamp of ["stowed", "held dry"]) {
        const world =
          lamp === "stowed"
            ? pinned({
                ...seats,
                op: "hold",
                world: fresh.world,
                choice: { item: null, revision: fresh.world.revision },
              }).world
            : structuredClone(fresh.world);
        if (lamp === "held dry")
          Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
        const sorted = Object.fromEntries(Object.entries(world.actors).toSorted());
        for (const actors of [world.actors, sorted]) {
          for (const key of routes) {
            const request = {
              ...seats,
              op: "play",
              world: { ...world, actors },
              action: actors === sorted ? { key } : key,
            };
            reference.primaryMove = undefined;
            const result = JSON.parse(reference.cardShared(JSON.stringify(request)));
            assert.equal(result.ok, true, result.error);
            const expected = JSON.parse(JSON.stringify(reference.primaryMove));
            const label = JSON.stringify({ history, seed, lamp, key });
            const actual = wasm({ ...request, op: "opening_mirror_move" });
            assert.ok(actual, `unsupported ${label}`);
            assert.deepEqual(actual, { ok: true, world: expected }, label);
            const entry = actual.world.log.at(-1);
            assert.deepEqual(entry.witnesses, ["vale", "lamp"]);
            assert.equal(entry.itemId, key === routes[0] ? null : "lamp");
            assert.equal(actual.world.items.lamp.holder, "vale");
            assert.equal(actual.world.actors.vale.heldItem, world.actors.vale.heldItem);
            assert.equal(actual.world.locations.attic.anchored, true);
            assert.deepEqual(actual.world.arrival, {
              seq: entry.seq,
              fromLocationId: "attic",
              locationId: "pond",
            });
          }
        }
      }
    }
  }
});

test("a lit held lamp keeps the mirror closed to both movement cards", async () => {
  const { pinned, wasm } = await reducers();
  const { world } = pinned({ op: "create" });
  for (const action of routes) {
    const request = { ...seats, world, action };
    assert.equal(pinned({ ...request, op: "play" }).ok, false);
    assert.equal(wasm({ ...request, op: "opening_mirror_move" }), null);
  }
});
