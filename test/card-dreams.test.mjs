import { describe, it, expect } from "vitest";
import { rest } from "./fixtures/card-rest.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedReflections,
} from "../v2/card-game/narrative.mjs";
import { fragment, roll, ruleDream } from "../v2/card-game/dreams.mjs";

const reflect = (world) => {
  const context = narrativeContext(world);
  return applyGeneratedReflections(world, context, {
    revision: context.revision,
    reflections: [
      {
        id: "vale",
        reflection: { thought: "The pond hums.", persona: "A seeker." },
      },
    ],
  });
};
const lamp = () => {
  const world = createWorld();
  return play(
    world,
    legalActions(world).find((a) => a.kind === "take" && a.item === "lamp"),
  ).state;
};

describe("rule-made dreams", () => {
  it("rolls and fragments are stable, short and trimmed", () => {
    expect(roll("vale", 40, 1)).toBe(roll("vale", 40, 1));
    expect(roll("vale", 40, 1)).not.toBe(roll("vale", 41, 1));
    const scrap = fragment("World: Pip carried the lamp, at dusk.", 7);
    expect(scrap).toMatch(/^[A-Z]/u);
    expect(scrap).not.toMatch(/[,.]$/u);
    expect(scrap.split(" ").length).toBeLessThanOrEqual(4);
    expect(fragment("Alone", 3)).toBeNull();
  });

  it("dreams at the Wait gate from memories and earlier dreams, the same every time", () => {
    const world = rest(lamp(), { dream: true });
    const next = reflect(world);
    expect(reflect(world)).toEqual(next);
    const [dream] = next.memories.vale.innerLife.dreams;
    expect(dream.turn).toBe(world.turn);
    expect(dream.text.length).toBeLessThanOrEqual(400);
    // A few short scraps, never model text.
    const pieces = dream.text.slice(0, -1).split(". ");
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length).toBeLessThanOrEqual(4);
    expect(next.memories.vale.reflections.at(-1).models.dream).toBe("rules");
    const context = narrativeContext(world);
    // Earlier dreams lead into the next one.
    const life = {
      persona: null,
      thoughts: [],
      dreams: [{ turn: 1, text: "A staircase grew feathers. Trains hummed." }],
    };
    const variants = new Set();
    for (let turn = 30; turn < 60; turn++)
      variants.add(ruleDream({ ...context, turn }, "vale", life));
    expect(variants.size).toBeGreaterThan(5);
    expect(
      [...variants].some((v) => /feathers|staircase|trains/iu.test(v)),
    ).toBe(true);
  });

  it("makes no dream before two thoughts settle", () => {
    const next = reflect(rest(lamp()));
    expect(next.memories.vale.innerLife.dreams).toEqual([]);
    expect(next.memories.vale.reflections.at(-1).dream).toBeNull();
  });
});
