import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const copy = (value) => JSON.parse(JSON.stringify(value));

function captureRumours(source) {
  const boundary = "    noteRumours(s, next, wantAPI(next), wantAPI(s));";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `    globalThis.beforeRumours = structuredClone(next);
${boundary}
    globalThis.afterRumours = structuredClone(next);`,
  );
}

test("historic pond return events become pinned place rumours for Pip", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureRumours);
  let gathered = 0;
  let quiet = 0;
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    const fresh = pinned({ op: "create", history: true, seed });
    assert.equal(fresh.ok, true, fresh.error);
    for (const lamp of ["stowed", "dry"]) {
      const world =
        lamp === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: fresh.world,
              choice: { item: null, revision: fresh.world.revision },
            }).world
          : structuredClone(fresh.world);
      if (lamp === "dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      for (const action of ["move:vale::pond", "move:vale:lamp:pond"]) {
        const move = {
          ...seats,
          op: "play",
          world,
          action,
        };
        const played = JSON.parse(
          reference.cardShared(JSON.stringify(move)),
        );
        assert.equal(played.ok, true, played.error);
        const previous = copy(reference.beforeRumours);
        const expected = copy(reference.afterRumours);
        assert.deepEqual(
          wasm({
            op: "opening_pond_rumours",
            world: previous,
            beforeSeq: world.eventSeq,
          }),
          { ok: true, world: expected },
        );
        if (expected.actors.moth.rumours) {
          gathered++;
          assert.equal(expected.actors.moth.rumours.length, 3);
          for (const rumour of expected.actors.moth.rumours) {
            assert.equal(rumour.kind, "place");
            assert.equal(rumour.holder, "vale");
            assert.equal(rumour.at, "pond");
            assert.equal(rumour.day, 10);
          }
          assert.equal(expected.actors.vale.rumours, undefined);
        } else quiet++;
      }
    }
  }
  assert.ok(gathered > 0 && quiet > 0);
});
