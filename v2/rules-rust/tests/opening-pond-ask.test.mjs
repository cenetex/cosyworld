import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const routes = ["move:vale::pond", "move:vale:lamp:pond"];

function capturePip(source) {
  const boundary =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `${boundary}
      if (id === "moth") globalThis.pipAsk = structuredClone(next);`,
  );
}

test("Pip's first request records the pinned refusal and learning trial", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capturePip);
  for (const seed of [undefined, 0, 17, 4242, 4294967295]) {
    const fresh = pinned({ op: "create", seed });
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
      const sorted = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
      for (const actors of [world.actors, sorted]) {
        for (const key of routes) {
          const request = {
            ...seats,
            world: { ...world, actors },
            action: actors === sorted ? { key } : key,
          };
          reference.pipAsk = undefined;
          const played = JSON.parse(
            reference.cardShared(JSON.stringify({ ...request, op: "play" })),
          );
          assert.equal(played.ok, true, played.error);
          const expected = JSON.parse(JSON.stringify(reference.pipAsk));
          const label = JSON.stringify({ seed, lamp, key });
          const actual = wasm({ ...request, op: "opening_pond_ask" });
          assert.ok(actual, `unsupported ${label}`);
          assert.deepEqual(actual, { ok: true, world: expected }, label);
          const { actors: cast, items, log, memories } = actual.world;
          const event = log.at(-1);
          assert.equal(event.verb, "ask");
          assert.equal(event.accepted, false);
          assert.equal(event.reason, "wants-something-else");
          assert.equal(cast.moth.want.refusals, 1);
          assert.equal(cast.moth.lastTalk, 1);
          assert.equal(items.lamp.holder, "vale");
          const [trial] = memories.moth.learning;
          const custody = JSON.parse(trial.conditions)[5];
          assert.deepEqual(custody, [
            ["cloth", "moth", null],
            ["lamp", "vale", items.lamp.fuel],
          ]);
          assert.equal(trial.seq, event.seq);
          assert.equal(trial.reward, -1);
        }
      }
    }
  }
});

test("Pip's first historic request matches the pinned memories after place returns", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(capturePip);
  for (const seed of [undefined, 2, 4242]) {
    const fresh = pinned({ op: "create", history: true, seed });
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
      const cards = Object.entries(world.placeCard ?? {});
      for (const reversed of [false, true]) {
        if (cards.length)
          world.placeCard = Object.fromEntries(
            reversed ? cards.toReversed() : cards,
          );
        const actors = reversed
          ? Object.fromEntries(Object.entries(world.actors).toSorted())
          : world.actors;
        for (const key of routes) {
          const request = {
            ...seats,
            world: { ...world, actors },
            action: reversed ? { key } : key,
          };
          reference.pipAsk = undefined;
          const played = JSON.parse(
            reference.cardShared(JSON.stringify({ ...request, op: "play" })),
          );
          assert.equal(played.ok, true, played.error);
          const expected = JSON.parse(JSON.stringify(reference.pipAsk));
          const label = JSON.stringify({ seed, lamp, reversed, key });
          const actual = wasm({ ...request, op: "opening_pond_ask" });
          assert.ok(actual, `unsupported ${label}`);
          assert.equal(
            isDeepStrictEqual(actual, { ok: true, world: expected }),
            true,
            label,
          );

          const event = actual.world.log.at(-1);
          const [trial] = actual.world.memories.moth.learning;
          assert.equal(event.verb, "ask");
          assert.equal(event.turn, world.began + 1);
          assert.equal(event.accepted, false);
          assert.equal(trial.seq, event.seq);
          assert.equal(actual.world.actors.moth.lastTalk, event.turn);
          if (seed === undefined)
            assert.ok(event.seq > actual.world.arrival.seq + 1);
        }
      }
    }
  }
});
