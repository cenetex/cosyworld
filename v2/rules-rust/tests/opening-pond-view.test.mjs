import assert from "node:assert/strict";
import { test } from "node:test";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function success(pinned, request) {
  const response = pinned(request);
  assert.equal(response.ok, true, response.error);
  return response;
}

test("the first pond view preserves the pinned offers and private save projection", async () => {
  const { pinned, wasm } = await reducers();
  for (const seed of [undefined, 17, 42, 4_294_967_295]) {
    const { world: fresh } = success(pinned, { op: "create", seed });
    for (const lamp of ["stowed", "dry"]) {
      const world =
        lamp === "stowed"
          ? success(pinned, {
              ...seats,
              op: "hold",
              world: fresh,
              choice: { item: null, revision: fresh.revision },
            }).world
          : structuredClone(fresh);
      if (lamp === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      for (const action of ["move:vale::pond", "move:vale:lamp:pond"]) {
        const played = success(pinned, { ...seats, op: "play", world, action });
        assert.equal(played.world.turn, 1);
        assert.ok(Object.hasOwn(played.world.memories.moth, "subjects"));
        const spoken = success(pinned, {
          ...seats,
          op: "speech",
          room: "pond",
          world: played.world,
          lines: [
            { actorId: "vale", text: "A narrow shore." },
            { actorId: "moth", text: "Follow me." },
            { entityId: "pond", text: "Dark water breathes." },
          ],
        });
        for (const state of [played.world, spoken.world]) {
          for (const present of [seats.present, []]) {
            const request = { ...seats, present, op: "view", world: state };
            const actual = wasm(request);
            const label = JSON.stringify({
              seed,
              lamp,
              action,
              present,
              seq: state.eventSeq,
            });
            assert.deepEqual(actual, success(pinned, request), label);
            assert.equal(actual.world.memories.moth.subjects, undefined);
            assert.deepEqual(actual.world.memories.vale, state.memories.vale);
            assert.deepEqual(actual.world.speechVoices.vale, ["vale", "moth"]);
            assert.deepEqual(actual.exits, ["station"]);
            assert.ok(
              actual.actions.some((offer) => offer.box === "greek-ship"),
            );
            assert.equal(
              actual.actions.some(
                (offer) => offer.key === "take:vale:elysium-wayfinder:",
              ),
              state.items["elysium-wayfinder"].holder === "pond",
            );
          }
        }
        const busy = structuredClone(played.world);
        busy.actors.keeper.place = "pond";
        assert.equal(wasm({ ...seats, op: "view", world: busy }), null);
        assert.equal(
          wasm({
            ...seats,
            op: "view",
            world: played.world,
            claimed: ["vale", "mara"],
          }),
          null,
        );
      }
    }
  }
});
