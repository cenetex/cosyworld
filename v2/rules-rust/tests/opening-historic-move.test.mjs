import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::pond", "move:vale:lamp:pond"];

function captureRound(source) {
  const end = "    if (dayOf(next) !== dayOf(s)) dailyRumours(next, wantAPI(next));";
  assert.equal(source.split(end).length, 2);
  return source.replace(
    end,
    `${end}
    globalThis.historicPond = structuredClone(next);`,
  );
}

test("the quiet historic pond Move matches the complete pinned round", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureRound);
  let asleep = 0;
  let awake = 0;
  let returns = 0;
  for (const seed of [undefined, 0, 17, 99, 4242, 4294967295]) {
    const fresh = pinned({ op: "create", history: true, seed });
    assert.equal(fresh.ok, true, fresh.error);
    for (const mode of ["stowed", "held dry"]) {
      const world =
        mode === "stowed"
          ? pinned({
              ...seats,
              op: "hold",
              world: fresh.world,
              choice: { item: null, revision: fresh.world.revision },
            }).world
          : structuredClone(fresh.world);
      if (mode === "held dry")
        Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
      const sorted = {
        ...world,
        actors: Object.fromEntries(Object.entries(world.actors).toSorted()),
        ...(world.placeCard && {
          placeCard: Object.fromEntries(
            Object.entries(world.placeCard).toSorted(),
          ),
        }),
      };
      for (const [order, saved] of [["authored", world], ["sorted", sorted]]) {
        for (const key of routes) {
          const request = {
            ...seats,
            world: saved,
            action: order === "authored" ? key : { key },
          };
          reference.historicPond = undefined;
          const played = JSON.parse(
            reference.cardShared(JSON.stringify({ ...request, op: "play" })),
          );
          assert.equal(played.ok, true, played.error);
          const label = JSON.stringify({ seed, mode, order, key });
          const actual = wasm({ ...request, op: "opening_full_move" });
          assert.ok(actual, `unsupported ${label}`);
          const expected = JSON.parse(JSON.stringify(reference.historicPond));
          assert.deepEqual(actual, { ok: true, world: expected }, label);
          assert.deepEqual(wasm({ ...request, op: "play" }), played, label);
          assert.deepEqual(
            actual.world.log.slice(-played.events.length),
            played.events,
          );
          assert.equal(actual.world.actors.moth.want.refusals, 1);
          if (actual.world.actors.moth.sleeping) asleep++;
          else awake++;
          if (played.events.some((entry) => entry.verb === "want_met")) returns++;
        }
      }
    }
  }
  assert.ok(asleep > 0 && awake > 0 && returns > 0);
});
