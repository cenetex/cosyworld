import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const op = "opening_station_train_quest";
const key = "accept:vale::box:train";

function success(pinned, request) {
  const reply = pinned(request);
  assert.equal(reply.ok, true, reply.error);
  return reply;
}

test("the quiet Station train quest matches the pinned complete acceptance reply", async () => {
  const { pinned, wasm } = await reducers();
  let request;
  let accepted;
  let placeOffer = false;
  let wayfinder = false;
  for (const seed of [undefined, 2, 17, 4242, 4_294_967_295]) {
    for (const mode of ["stowed", "dry"]) {
      let { world } = success(pinned, { op: "create", seed });
      if (mode === "dry") {
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      } else {
        ({ world } = success(pinned, {
          ...seats, op: "hold", world,
          choice: { item: null, revision: world.revision },
        }));
      }
      for (const waited of [false, true]) {
        let saved = waited ? success(pinned, { ...seats, op: "play", world, action: "wait:vale::" }).world : world;
        ({ world: saved } = success(pinned, { ...seats, op: "play", world: saved, action: "move:vale::pond" }));
        const move = mode === "dry" ? "move:vale:lamp:station" : "move:vale::station";
        ({ world: saved } = success(pinned, { ...seats, op: "play", world: saved, action: move }));
        if (!waited && seed === 2) {
          ({ world: saved } = success(pinned, {
            ...seats, op: "speech", room: "station", world: saved,
            lines: [{ actorId: "keeper", text: "The train is still out of sight." }],
          }));
        }
        saved.actors = Object.fromEntries(Object.entries(saved.actors).sort());
        request = { ...seats, world: saved, action: waited ? { key } : key, revision: saved.revision };
        const expected = success(pinned, { ...request, op: "play" });
        accepted = wasm({ ...request, op });
        const label = JSON.stringify({ seed, mode, waited });
        assert.ok(isDeepStrictEqual(accepted, expected), label);
        assert.equal(accepted.world.revision, saved.revision + 1);
        assert.equal(accepted.world.turn, saved.turn);
        assert.equal(accepted.world.eventSeq, saved.eventSeq);
        assert.deepEqual(accepted.events, []);
        assert.ok(accepted.actions.some((action) => action.key === "drop:vale:::0"));
        assert.ok(accepted.actions.every((action) => action.key !== key));
        placeOffer ||= accepted.actions.some((action) => action.key === "accept:vale::place:station");
        wayfinder ||= accepted.actions.some((action) => action.key === "take:vale:elysium-wayfinder:");
      }
    }
  }
  assert.ok(placeOffer && wayfinder);
  const repeat = { ...request, world: accepted.world, revision: accepted.world.revision };
  assert.equal(pinned({ ...repeat, op: "play" }).ok, false);
  assert.equal(wasm({ ...repeat, op }), null);
  assert.equal(wasm({ ...request, op, revision: request.revision - 1 }), null);
  const open = structuredClone(request.world);
  open.items.routes.holder = "station";
  assert.equal(pinned({ ...request, op: "play", world: open }).ok, false);
  assert.equal(wasm({ ...request, op, world: open }), null);
});
