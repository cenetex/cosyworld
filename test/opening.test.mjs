import { describe, expect, it } from "vitest";
import { openingStep } from "../v2/card-game/opening.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { createWorld, holdChoice, exits } from "../v2/card-game/world.mjs";

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

  it("opens the mirror by quietly stowing, with no special play", () => {
    const next = structuredClone(world);
    expect(openingStep(next, "vale", down())).toEqual({ step: "play", choice: ["lamp"] });
    holdChoice(next, "vale", { item: null, revision: next.revision });
    expect(next.turn).toBe(world.turn);
    expect(next.items.lamp.lit).toBe(false);
    expect(next.items.lamp.holder).toBe("vale");
    expect(exits(next, "attic")).toContain("pond");
    expect(openingStep(next, "vale", down())).toBeNull();
  });

  it("is past for a world that has moved on or never opened here", () => {
    expect(openingStep({ ...world, turn: 1 }, "vale", down())).toBe(null);
    expect(openingStep({ ...world, opening: false }, "vale", down())).toBe(
      null,
    );
  });
});

it("ends the opening after quiet stow without requiring a world turn", () => {
  const world = createWorld({ opening: true });
  world.items.lamp.lit = false;
  world.actors.vale.heldItem = null;
  expect(world.turn).toBe(0);
  expect(openingStep(world, "vale", () => false)).toBeNull();
});
