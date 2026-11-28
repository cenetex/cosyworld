import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const actor = "ada";
const ship = "greek-ship";

function projectTransport(source) {
  const boundary = "  globalThis.cardShared = (json) => {";
  assert.equal(source.split(boundary).length, 2);
  return source.replace(
    boundary,
    `  globalThis.visitorTransport = (json) => {
    const {world, actor, place, previous} = JSON.parse(json);
    const boards = crossingExits(world, place, actor, sensesFor(world)).filter(
      (to) => Object.values(transports).some((ship) => ship.place === to),
    );
    const aboard = transportExits(world, place, previous, actor);
    return JSON.stringify({ok: true, boards, aboard});
  };
${boundary}`,
  );
}

test("the picked-up sail loft key exposes pinned dock and ship traversal", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(projectTransport);
  const compare = (world, place, previous) => {
    const request = { op: "visitor_transport", world, actor, place, previous };
    const expected = JSON.parse(reference.visitorTransport(JSON.stringify(request)));
    assert.deepEqual(wasm(request), expected, JSON.stringify({ place, previous }));
    return expected;
  };
  const fresh = pinned({ op: "create", seed: 17 });
  for (const action of ["wait:vale::", "drop:vale:lamp:attic"]) {
    const first = pinned({ ...seats, op: "play", world: fresh.world, action });
    assert.equal(first.ok, true, first.error);
    const world = first.world;
    assert.equal(world.actors.ada.place, "loft");
    assert.equal(world.items.shears.holder, actor);
    assert.equal(world.doors.loft, ship);
    assert.deepEqual(compare(world, "greek-harbor").boards, []);
    assert.deepEqual(compare(world, ship, "loft").aboard, ["pond"]);

    const unlocked = structuredClone(world);
    unlocked.crossings["pond-greek-harbor"].discovered = true;
    assert.deepEqual(compare(unlocked, "greek-harbor").boards, [ship]);
    compare(unlocked, ship, "greek-harbor");
    const loaded = structuredClone(unlocked);
    loaded.usedUp = loaded.usedUp.filter((item) => item !== "greek-provisions");
    loaded.items["greek-provisions"].holder = ship;
    loaded.items["hoppycat-red-thread-spool"].holder = "greek-provisions";
    const seaRoute = compare(loaded, ship, "loft").aboard;
    assert.ok(seaRoute.includes("greek-piraeus"));
    assert.ok(seaRoute.includes("hoppycat-signal-jetty"));
    compare(loaded, ship, "pond");

    const aboard = structuredClone(loaded);
    aboard.actors[actor].place = ship;
    aboard.transports[ship].phase = "arrived";
    aboard.transports[ship].riders = [actor];
    assert.equal(compare(aboard, ship).aboard[0], "greek-harbor");
    compare(aboard, ship, "@voyage");
    aboard.actors.vale.place = ship;
    assert.deepEqual(compare(aboard, ship).aboard, ["greek-harbor"]);

    aboard.transports[ship].phase = "sea";
    aboard.transports[ship].destination = "greek-piraeus";
    assert.deepEqual(compare(aboard, ship).aboard, []);
    assert.equal(compare(aboard, ship, "@voyage").aboard[0], "greek-piraeus");
    assert.deepEqual(compare(aboard, "greek-harbor").boards, []);
  }
});
