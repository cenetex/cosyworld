import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { NOT_FOUND, questStep } from "../v2/card-game/quest-step.mjs";
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

describe("a chosen quest's completion action", () => {
  it("offers a move that reaches the goal", () => {
    const s = createWorld();
    s.actors.vale.place = "greek-gate";
    s.actors.vale.visited.push("pond");
    s.crossings["pond-greek-harbor"].discovered = true;
    expect(questStep(s, quest("place", "pond"), false)).toBe(null);
    s.actors.vale.place = "station";
    expect(shown(questStep(s, quest("place", "pond"), false))).toEqual([
      "move",
      "pond",
      null,
    ]);
    // The move is one the rules already offer.
    const step = questStep(s, quest("place", "pond"), false).action;
    expect(legalActions(s).some((a) => a.key === step.key)).toBe(true);
  });

  it("keeps covered goals hidden and leaves distant goals to the player", () => {
    const s = createWorld();
    expect(questStep(s, quest("place", "greek-gate"), false)).toBe(null);
    expect(questStep(s, quest("item", "oil"), true)).toEqual({
      reason: NOT_FOUND,
    });
  });

  it("offers a local Talk or acquisition for those exact goals", () => {
    const s = createWorld();
    expect(questStep(s, quest("person", "keeper"), false)).toBe(null);
    s.actors.vale.place = "pond";
    expect(shown(questStep(s, quest("person", "keeper"), false))).toEqual([
      "talk",
      "keeper",
      null,
    ]);
    s.actors.keeper.want = null;
    s.actors.keeper.trust.vale = 1;
    s.items.cloth.holder = "keeper";
    expect(shown(questStep(s, quest("item", "cloth"), false))).toEqual([
      "ask",
      "keeper",
      "cloth",
    ]);
  });

  it("offers each ready Hollow stage and leaves supply gathering to the player", () => {
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
      expect(questStep(world, questCard(world), false)).toBe(null);
    }
  });

  it("offers delivery only when the item is carried", () => {
    const s = createWorld();
    s.actors.vale.place = "pond";
    const give = quest("item", "oil", { verb: "give", to: "keeper" });
    expect(questStep(s, give, false)).toBe(null);
    s.items.oil.holder = "vale";
    s.actors.keeper.want = {
      kind: "item",
      target: "oil",
      since: 0,
      refusals: 0,
    };
    expect(shown(questStep(s, give, false))).toEqual(["give", "keeper", "oil"]);
    const bring = quest("item", "oil", { verb: "bring", at: "station" });
    expect(shown(questStep(s, bring, false))).toEqual([
      "move",
      "station",
      null,
    ]);
    s.items.oil.holder = "keeper";
    expect(questStep(s, bring, false)).toBe(null);
  });

  it("leaves a refused request to ordinary card play", () => {
    const s = createWorld();
    s.actors.vale.place = "pond";
    s.actors.vale.want = { kind: "item", target: "oil", since: 0, refusals: 0 };
    s.actors.keeper.want = { ...s.actors.vale.want };
    expect(questStep(s, questCard(s), false)).toBe(null);
    const ask = legalActions(s).find(
      (a) => a.kind === "ask" && a.item === "oil",
    );
    expect(
      play(s, ask).state.log.some(
        (e) => e.verb === "ask" && e.accepted === false,
      ),
    ).toBe(true);
  });

  it("completes Bring by taking the item at its destination", () => {
    const s = createWorld();
    s.actors.vale.place = "pond";
    s.items.oil.holder = "pond";
    s.actors.vale.want = {
      kind: "item",
      target: "oil",
      step: { verb: "bring", at: "pond", to: "keeper" },
      quest: { level: 2, left: 2 },
      since: 0,
      refusals: 0,
    };
    const action = questStep(s, questCard(s), false).action;
    expect(action.kind).toBe("take");
    expect(
      play(s, action).state.log.some(
        (e) => e.verb === "want_met" && e.actorId === "vale",
      ),
    ).toBe(true);
  });

  it("offers the act that leaves a lamp held as wanted", () => {
    const s = createWorld();
    s.actors.vale.want = {
      kind: "item",
      target: "lamp",
      lit: true,
      since: 0,
      refusals: 0,
    };
    s.items.lamp.holder = "pond";
    s.items.lamp.lit = true;
    expect(questStep(s, questCard(s), false)).toBe(null);
    s.items.lamp.holder = "station";
    const action = questStep(s, questCard(s), false).action;
    expect(action.kind).toBe("take");
    expect(
      play(s, action).state.log.some(
        (e) => e.verb === "want_met" && e.actorId === "vale",
      ),
    ).toBe(true);
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
