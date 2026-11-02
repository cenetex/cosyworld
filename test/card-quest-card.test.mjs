import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  isQuestId,
  metQuests,
  questCaption,
  questCard,
  questCards,
  questDistance,
  questHand,
  questId,
  questNear,
  questVerb,
} from "../v2/card-game/quest-card.mjs";
import { QUEST_LIMIT } from "../v2/card-game/want.mjs";

describe("the quest card", () => {
  it("shows the player's want in the rules' words, covered until uncovered", () => {
    const s = createWorld();
    const quest = questCard(s);
    expect(quest).toMatchObject({
      actor: "vale",
      kind: "item",
      target: "lamp",
    });
    expect(questCaption(quest)).toBe("Hold Lamp");
    expect(questCaption(quest, true)).toBe(
      "Hold something you have not found yet",
    );
  });

  it("explains an undiscovered destination without naming it", () => {
    const s = createWorld();
    const quest = { ...questCard(s), kind: "place", target: "clearing" };
    expect(questCaption(quest, true)).toBe(
      "Go somewhere you have not found yet",
    );
    expect(questCaption(quest)).toBe("Go to Forest Clearing");
    expect(questVerb(s, quest, true)).toBe("Discover");
  });

  it("uses the visible place verb for covered, known, and visited destinations", () => {
    const s = createWorld();
    const quest = { ...questCard(s), kind: "place", target: "clearing" };
    const caption = (covered) =>
      questCaption(quest, covered, questVerb(s, quest, covered));
    expect(caption(true)).toBe("Discover somewhere you have not found yet");
    expect(caption(false)).toBe("Discover Forest Clearing");
    s.actors.vale.visited.push("clearing");
    expect(caption(false)).toBe("Go to Forest Clearing");
  });

  it("keeps the level and rest instruction alongside the visible place verb", () => {
    const s = createWorld();
    const quest = {
      ...questCard(s),
      kind: "place",
      target: "pond",
      level: 3,
      step: { verb: "rest" },
    };
    expect(questCaption(quest, true, questVerb(s, quest, true))).toBe(
      "Level III: Discover somewhere you have not found yet and rest there",
    );
    expect(questCaption(quest, false, questVerb(s, quest))).toBe(
      "Level III: Go to Black pond and rest there",
    );
  });

  it("describes an unmet person without revealing their name", () => {
    const quest = {
      ...questCard(createWorld()),
      kind: "person",
      target: "moth",
    };
    expect(questCaption(quest, true)).toBe(
      "Talk with someone you have not met yet",
    );
    expect(questCaption(quest)).toBe("Talk with Pip");
  });

  it("keeps the homecoming action and home when its belonging is covered", () => {
    const quest = {
      ...questCard(createWorld()),
      actor: "mara",
      target: "mask",
      step: { verb: "bring", at: "theatre" },
    };
    expect(questCaption(quest, true)).toBe(
      "Bring something you have not found yet home to Paper theatre",
    );
    expect(questCaption(quest)).toBe(
      "Bring Theatre mask home to Paper theatre",
    );
  });

  it("keeps level and step context while covering only the target", () => {
    const quest = {
      ...questCard(createWorld()),
      level: 3,
      step: { verb: "bring", to: "moth", at: "pond" },
    };
    expect(questCaption(quest, true)).toBe(
      "Level III: Bring something you have not found yet to Pip at Black pond",
    );
    expect(questCaption(quest)).toBe(
      "Level III: Bring Lamp to Pip at Black pond",
    );
    expect(
      questCaption(
        { ...quest, kind: "place", target: "pond", step: { verb: "rest" } },
        true,
      ),
    ).toBe("Level III: Rest at a place you have not found yet");
  });

  it("keeps a connection quest without inventing an undiscovered target", () => {
    const quest = {
      ...questCard(createWorld()),
      kind: "connect",
      target: null,
    };
    expect(questCaption(quest, true)).toBe("Introduce two people");
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
    expect(questNear(s, { ...quest, kind: "connect", target: null })).toBe(
      false,
    );
  });

  it("names the quest with one short verb", () => {
    const s = createWorld();
    const quest = questCard(s);
    expect(questVerb(s, quest)).toBe("Hold");
    expect(questVerb(s, { ...quest, kind: "person", target: "moth" })).toBe(
      "Talk",
    );
    const here = { ...quest, kind: "place", target: s.actors.vale.place };
    expect(questVerb(s, here)).toBe("Go to");
    expect(questVerb(s, here, true)).toBe("Discover");
  });

  it("places the quest cards after the player's avatar and belongings", () => {
    const s = createWorld();
    const ids = [questId(0, true), questId(0), questId(1)];
    const hand = questHand(availableCards(s), s, ids);
    expect(hand.filter(isQuestId)).toEqual(ids);
    expect(hand.indexOf(ids[0])).toBeGreaterThan(hand.indexOf("vale"));
    expect(questHand(hand, s, ids).filter(isQuestId)).toEqual(ids);
    expect(questHand(hand, s).some(isQuestId)).toBe(false);
  });

  it("shows the whole stack, top first", () => {
    const s = createWorld();
    s.actors.vale.under = [
      { kind: "place", target: "pond", since: 0, refusals: 0 },
    ];
    expect(questCards(s).map((q) => [q.index, q.target])).toEqual([
      [0, "lamp"],
      [1, "pond"],
    ]);
    expect(questCard(s).target).toBe("lamp");
  });

  it("seals a quest only when the rules met it", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.lamp.holder = "attic";
    s.actors.vale.under = [
      { kind: "place", target: "pond", since: 0, refusals: 0 },
    ];
    const before = questCards(s),
      seq = s.eventSeq;
    const move = legalActions(s).find(
      (a) => a.kind === "move" && a.target === "pond",
    );
    s = play(s, move).state;
    expect(metQuests(before, s, seq).map((q) => q.target)).toEqual(["pond"]);
    // A dropped quest is gone without a seal.
    const shown = questCards(s),
      at = s.eventSeq;
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "drop" && !a.item),
    ).state;
    expect(metQuests(shown, s, at)).toEqual([]);
  });

  it("never shows more quest cards than the stack holds through a long run", () => {
    let s = createWorld();
    for (let turn = 0; turn < 400; turn++) {
      const actions = legalActions(s);
      s = play(s, actions[(turn * 7919) % actions.length]).state;
      const cards = questCards(s);
      expect(cards.length).toBeLessThanOrEqual(QUEST_LIMIT);
      for (const quest of cards) {
        expect(questCaption(quest)).toMatch(/^[A-Z]/);
        expect(typeof questNear(s, quest)).toBe("boolean");
      }
    }
    expect(validateWorld(s)).toBe(s);
  });
});
