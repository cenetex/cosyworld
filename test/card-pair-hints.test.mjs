import { describe, it, expect } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { createWorld } from "../v2/card-game/world.mjs";

function station() {
  const world = createWorld();
  for (const id of ["vale", "moth"]) world.actors[id].place = "station";
  return world;
}

describe("item and resident pair reasons", () => {
  it("asks to take a loose item first, not for carrying space", () => {
    const world = station();
    world.items.lamp.holder = "station";
    const { action, hint } = cardPlay(world, ["lamp", "moth"]);
    expect(action).toBeFalsy();
    expect(hint).toBe("Take the Lamp first.");
  });

  it("says the traveler's hands are full when their item cannot be asked for", () => {
    const world = station();
    world.items.lamp.holder = "moth";
    const mine = Object.keys(world.items)
      .filter((id) => !["lamp", "cloth"].includes(id))
      .slice(0, 3);
    for (const id of mine) world.items[id].holder = "vale";
    const reason = "Make room to ask for the Lamp.";
    expect(cardPlay(world, ["lamp"]).action).toBeFalsy();
    expect(cardPlay(world, ["lamp"]).hint).toBe(reason);
    expect(cardPlay(world, ["lamp", "moth"]).hint).toBe(reason);
    world.items[mine[0]].holder = "station";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("ask");
  });

  it("gives a carried item to the resident", () => {
    const world = station();
    world.items.lamp.holder = "vale";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("give");
  });
});
