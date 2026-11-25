import assert from "node:assert/strict";
import { it } from "vitest";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import {
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

it("calls the ship before gifting the Lamp through the unchanged seed 23 opening", () => {
  let world = createLandingWorld(null, 23);
  const trace = [];
  const act = (key) => {
    const actions = legalActions(world, "vale");
    const action = actions.find((candidate) => candidate.key === key);
    assert(action, `Missing ${key} after ${trace.join(", ")}`);
    const result = play(world, action, world.revision);
    assert(result.ok, result.error);
    world = result.state;
    trace.push(key);
  };
  const hold = (item) => {
    const turn = world.turn;
    holdChoice(world, "vale", { item, revision: world.revision });
    assert.equal(world.turn, turn, "Choosing a hand spends no turn");
  };

  // Use the real new-game state and resident rounds. No custody, trust,
  // location, fuel, or resident goal is supplied by a fixture.
  assert.equal(world.actors.vale.place, "attic");
  assert.equal(world.items.cloth.holder, "moth");
  assert.equal(world.items.lamp.holder, "vale");
  hold(null);
  for (const key of [
    "move:vale::pond",
    "talk:vale::moth",
    "move:vale::station",
    "talk:vale::keeper",
    "talk:vale::moth",
  ]) {
    act(key);
    assert.equal(world.items.lamp.holder, "vale");
  }

  // Pip follows the Lamp to the station, then tries a gift after his request
  // was declined. This is his own accepted play, not a successful Ask.
  assert.equal(world.actors.moth.place, "station");
  assert.equal(world.actors.moth.trust.vale, 0);
  assert.equal(world.items.cloth.holder, "vale");
  assert(
    world.log.some(
      (event) =>
        event.turn === 5 &&
        event.verb === "give" &&
        event.actorId === "moth" &&
        event.itemId === "cloth" &&
        event.targetId === "vale" &&
        event.accepted === true,
    ),
  );
  act("move:vale::pond");
  hold("cloth");
  assert.equal(world.crossings["pond-greek-harbor"].discovered, false);
  act("drop:vale:lamp:pond");

  assert.equal(world.turn, 7);
  assert.equal(world.actors.vale.place, "pond");
  assert.equal(world.actors.vale.heldItem, "cloth");
  assert.equal(world.items.cloth.holder, "vale");
  assert.equal(world.actors.moth.place, "station");
  assert.equal(world.items.lamp.holder, "pond");
  assert.equal(world.items.lamp.lit, true);
  assert.equal(world.items.lamp.fuelRooms, 2);
  assert.equal(world.crossings["pond-greek-harbor"].discovered, true);
  assert.equal(world.transports["greek-ship"].dock, "pond");

  // Saving requires no extra Wait. The same Lamp remains available for Pip
  // after the call; taking it back does not revoke the discovered crossing.
  world = decodeSave(encodeSave(world));
  act("take:vale:lamp:");
  act("move:vale::station");
  act("give:vale:lamp:moth");
  assert.equal(world.turn, 10);
  assert.equal(world.items.lamp.holder, "moth");
  assert.equal(world.items.lamp.lit, true);
  assert.equal(world.items.lamp.fuelRooms, 1);
  assert.equal(world.actors.moth.want, null);
  assert.equal(world.actors.moth.trust.vale, 1);
  assert.equal(world.items.cloth.holder, "vale");
  assert.equal(world.crossings["pond-greek-harbor"].discovered, true);
});
