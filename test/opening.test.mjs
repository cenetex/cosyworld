import { describe, expect, it } from "vitest";
import { openingStep } from "../v2/card-game/opening.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";

describe("a new world's opening", () => {
  const world = createLandingWorld(null, 1);
  const down =
    (...ids) =>
    (id) =>
      ids.includes(id);

  it("starts with the avatar when the title was skipped", () => {
    expect(openingStep(world, "vale", down("vale", "lamp", "attic"))).toEqual({
      step: "reveal",
      next: "vale",
    });
    expect(openingStep(world, "vale", down("vale"))).toEqual({
      step: "reveal",
      next: "vale",
    });
  });

  it("reveals the lit lamp and the attic, in either order, before a play", () => {
    expect(openingStep(world, "vale", down("lamp", "attic"))).toEqual({
      step: "reveal",
      next: "lamp",
    });
    expect(openingStep(world, "vale", down("attic"))).toEqual({
      step: "reveal",
      next: "attic",
    });
    expect(openingStep(world, "vale", down("lamp"))).toEqual({
      step: "reveal",
      next: "lamp",
    });
  });

  it("then offers the rules' own Put out, which brings a new card", () => {
    const step = openingStep(world, "vale", down());
    expect(step).toEqual({ step: "play", choice: ["lamp"] });
    const action = cardPlay(world, step.choice).action;
    expect(action.kind).toBe("snuff");
    expect(legalActions(world).some((a) => a.key === action.key)).toBe(true);
    const after = play(world, action);
    const next = after.state ?? after;
    expect(next.items.lamp.lit).toBe(false);
    expect(openingStep(next, "vale", down())).toBe(null);
  });

  it("is past for a world that has moved on or never opened here", () => {
    expect(openingStep({ ...world, turn: 1 }, "vale", down())).toBe(null);
    expect(openingStep({ ...world, opening: false }, "vale", down())).toBe(
      null,
    );
  });
});
