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

  it("gives a carried item to the resident", () => {
    const world = station();
    world.items.lamp.holder = "vale";
    expect(cardPlay(world, ["lamp", "moth"]).action?.kind).toBe("give");
  });
});
