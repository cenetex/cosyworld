import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { cardPlay, sharedMeal } from "../v2/card-game/cards.mjs";

function sanctuary() {
  const world = enableMotives(createWorld());
  world.actors.vale.place = "greek-sanctuary";
  world.actors["greek-ismene"].place = "greek-sanctuary";
  world.crossings["pond-greek-harbor"].discovered = true;
  world.items["greek-bread"].holder = "vale";
  world.usedUp = world.usedUp.filter((id) => id !== "greek-bread");
  return world;
}

describe("a shared meal", () => {
  it("is not carried food chosen with the place and a loose thing", () => {
    const world = sanctuary();
    const cards = ["greek-bread", "greek-sanctuary", "greek-figs"];
    expect(cardPlay(world, cards).action?.kind).toBe("eat");
    expect(sharedMeal(world, cards)).toBe(false);
    expect(cardPlay(world, ["greek-figs"]).action?.kind).toBe("take");
  });

  it("is food chosen with the player and someone to share it with", () => {
    const world = sanctuary();
    const cards = ["vale", "greek-bread", "greek-ismene"];
    expect(cardPlay(world, cards).action).toMatchObject({
      kind: "eat",
      target: "greek-ismene",
    });
    expect(sharedMeal(world, cards)).toBe(true);
  });
});
