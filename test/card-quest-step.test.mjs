import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { NO_WAY, NOT_FOUND, questStep } from "../v2/card-game/quest-step.mjs";
import { questCard } from "../v2/card-game/quest-card.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const quest = (kind, target, step = null) => ({
  actor: "vale",
  kind,
  target,
  step,
});
const shown = (r) =>
  r?.action ? [r.action.kind, r.action.target, r.action.item] : r;

describe("a chosen quest's next step", () => {
  it("offers the first legal move on the way to a place", () => {
    const s = createWorld();
    s.actors.vale.place = "greek-gate";
    s.actors.vale.visited.push("pond");
    s.crossings["pond-greek-harbor"].discovered = true;
    expect(shown(questStep(s, quest("place", "pond"), false))).toEqual([
      "move",
      "greek-courtyard",
      null,
    ]);
    // The move is one the rules already offer.
    const step = questStep(s, quest("place", "pond"), false).action;
    expect(legalActions(s).some((a) => a.key === step.key)).toBe(true);
  });

  it("says why when there is no way, or the target is not found", () => {
    const s = createWorld();
    expect(questStep(s, quest("place", "greek-gate"), false)).toEqual({
      reason: NO_WAY,
    });
    expect(questStep(s, quest("item", "oil"), true)).toEqual({
      reason: NOT_FOUND,
    });
  });

  it("talks or asks where the target stands, and walks there first", () => {
    const s = createWorld();
    expect(shown(questStep(s, quest("person", "keeper"), false))).toEqual([
      "move",
      "pond",
      null,
    ]);
    s.actors.vale.place = "pond";
    expect(shown(questStep(s, quest("person", "keeper"), false))).toEqual([
      "talk",
      "keeper",
      null,
    ]);
    expect(shown(questStep(s, quest("item", "oil"), false))).toEqual([
      "ask",
      "keeper",
      "oil",
    ]);
  });

  it("offers each Hollow gift or picks up the next supply first", () => {
    const { beforeAnoint, anointed, veiled } = funeralJourney();
    for (const [world, item] of [
      [beforeAnoint, "greek-oil-flask"],
      [anointed, "greek-funeral-cloth"],
      [veiled, "greek-shovel"],
    ]) {
      expect(shown(questStep(world, questCard(world), false))).toEqual([
        "give",
        "greek-antigone",
        item,
      ]);
      world.items[item].holder = "greek-polynices-hollow";
      expect(shown(questStep(world, questCard(world), false))).toEqual([
        "take",
        null,
        item,
      ]);
    }
  });

  it("holds the Hollow quest action until its supplies and Antigone are there", () => {
    const { beforeAnoint: world } = funeralJourney();
    world.items["greek-funeral-cloth"].holder = "greek-sanctuary";
    expect(questStep(world, questCard(world), false)).toBe(null);
    world.items["greek-funeral-cloth"].holder = "vale";
    world.actors["greek-antigone"].place = "greek-gate";
    expect(questStep(world, questCard(world), false)).toBe(null);
  });

  it("rests at a sanctuary quest's place, and has no step to introduce", () => {
    const s = createWorld();
    const here = s.actors.vale.place;
    expect(questStep(s, quest("place", here, { verb: "rest" }), false)).toEqual(
      { rest: true },
    );
    expect(questStep(s, quest("connect", null), true)).toBe(null);
  });
});
