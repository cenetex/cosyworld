import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  currentActor,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  QUEST_CARD,
  questCaption,
  questCard,
  questDistance,
  questHand,
  questMet,
  questNear,
  questVerb,
} from "../v2/card-game/quest-card.mjs";

describe("the quest card", () => {
  it("shows the player's want in the rules' words, covered until uncovered", () => {
    const s = createWorld();
    const quest = questCard(s);
    expect(quest).toMatchObject({ actor: "vale", kind: "item", target: "lamp" });
    expect(questCaption(quest)).toBe("Hold Lamp");
    expect(questCaption(quest, true)).toBe("Hold …");
  });

  it("shows only near or far, never who holds the target or how far", () => {
    const s = createWorld();
    const quest = questCard(s);
    s.items.lamp.holder = "moth";
    s.actors.moth.place = s.actors.vale.place;
    expect(questNear(s, quest)).toBe(true);
    const place = { ...quest, kind: "place", target: s.actors.vale.place };
    expect(questNear(s, place)).toBe(true);
    const exit = legalActions(s).find((a) => a.kind === "move");
    expect(questDistance(s, "vale", exit.target)).toBe(1);
    expect(questNear(s, { ...place, target: exit.target })).toBe(true);
    expect(questNear(s, { ...quest, kind: "connect", target: null })).toBe(false);
  });

  it("names the quest with one short verb", () => {
    const s = createWorld();
    const quest = questCard(s);
    expect(questVerb(s, quest)).toBe("Hold");
    expect(questVerb(s, { ...quest, kind: "person", target: "moth" })).toBe("Talk");
    const here = { ...quest, kind: "place", target: s.actors.vale.place };
    expect(questVerb(s, here)).toBe("Go to");
    expect(questVerb(s, here, true)).toBe("Discover");
  });

  it("places one quest card after the player's avatar and belongings", () => {
    const s = createWorld();
    const hand = questHand(availableCards(s), s);
    expect(hand.filter((id) => id === QUEST_CARD)).toHaveLength(1);
    expect(hand.indexOf(QUEST_CARD)).toBeGreaterThan(hand.indexOf("vale"));
    expect(questHand(hand, s).filter((id) => id === QUEST_CARD)).toHaveLength(1);
    s.actors.vale.want = null;
    expect(questHand(hand, s)).not.toContain(QUEST_CARD);
  });

  it("is met only when the same avatar's quest changes as it gains experience", () => {
    const a = { actor: "vale", key: "1", xp: 0 };
    expect(questMet(a, { actor: "vale", key: "2", xp: 1 })).toBe(true);
    expect(questMet(a, { actor: "vale", key: "2", xp: 0 })).toBe(false);
    expect(questMet(a, { actor: "moth", key: "2", xp: 3 })).toBe(false);
    expect(questMet(a, null)).toBe(false);
  });

  it("never shows more than one quest card through a long run", () => {
    let s = createWorld();
    for (let turn = 0; turn < 400; turn++) {
      const actions = legalActions(s);
      s = play(s, actions[(turn * 7919) % actions.length]).state;
      const quest = questCard(s);
      const hand = questHand(availableCards(s), s);
      expect(hand.filter((id) => id === QUEST_CARD)).toHaveLength(
        s.actors[currentActor(s)].want ? 1 : 0,
      );
      if (quest) {
        expect(questCaption(quest)).toMatch(/^[A-Z]/);
        expect(typeof questNear(s, quest)).toBe("boolean");
      }
    }
    expect(validateWorld(s)).toBe(s);
  });
});
