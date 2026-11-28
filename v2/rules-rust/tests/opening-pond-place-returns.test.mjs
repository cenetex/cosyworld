import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };

function captureReturns(source) {
  const boundary = "    settlePlaceCards(s, a.actor, wantAPI(s), from);";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `${boundary}
    if (a.actor === "vale" && a.kind === "move" && from === "attic") {
      globalThis.pondPlaceReturns = structuredClone(s);
    }`,
  );
}

test("the first historic pond arrival matches pinned place returns and scene memories", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(captureReturns);
  for (const seed of [undefined, 2, 42, 4242]) {
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
      }
      const cards = Object.entries(world.placeCard ?? {});
      for (const reversed of [false, true]) {
        const actors = Object.fromEntries(Object.entries(world.actors).toSorted());
        if (cards.length) {
          world.placeCard = Object.fromEntries(
            reversed ? cards.toReversed() : cards,
          );
        }
        const key = lamp === "stowed" ? "move:vale::pond" : "move:vale:lamp:pond";
        const request = {
          ...seats,
          world: { ...world, actors: reversed ? actors : world.actors },
          action: reversed ? { key } : key,
        };
        reference.pondPlaceReturns = undefined;
        const played = JSON.parse(
          reference.cardShared(JSON.stringify({ ...request, op: "play" })),
        );
        assert.equal(played.ok, true, played.error);
        const expected = JSON.parse(JSON.stringify(reference.pondPlaceReturns));
        const actual = wasm({ ...request, op: "opening_pond_place_returns" });
        const label = JSON.stringify({ seed, lamp, reversed });
        assert.ok(actual, `unsupported ${label}`);
        assert.ok(isDeepStrictEqual(actual, { ok: true, world: expected }), label);

        const returns = actual.world.log.filter(
          (entry) => entry.seq > world.eventSeq && entry.verb === "want_met",
        );
        if (seed === undefined) assert.ok(returns.length > 1);
        if (seed === 4242) assert.equal(returns.length, 0);
        for (const event of returns) {
          assert.equal(event.locationId, "pond");
          assert.ok(event.cast.includes("moth"));
        }
      }
    }
  }
});
