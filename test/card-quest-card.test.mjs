import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  legalActions,
  nameOf,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  isQuestId,
  questCaption,
  questCard,
  questBox,
  questCards,
  questDistance,
  questGround,
  handWithQuest,
  questId,
  questNear,
  questTier,
  questVerb,
} from "../v2/card-game/quest-card.mjs";
import { cardLevel, levelTier } from "../v2/card-game/rarity.mjs";
import { UNKNOWN } from "../v2/card-game/world/want-words.mjs";

// An undiscovered card is worded by its kind, never by name.
const { person: PERSON, place: PLACE } = UNKNOWN;

describe("the quest card", () => {
  it("shows a Give's place only when the gift is bound to one", () => {
    const s = baseCreateWorld();
    s.actors.vale.place = "greek-gate";
    s.items["greek-decree"].holder = "vale";
    const give = (step) => ({
      actor: "vale",
      kind: "item",
      target: "greek-decree",
      step: { verb: "give", to: "greek-guard", ...step },
    });
    // Unbound: the player, the thing and the recipient, with no place.
    expect(questGround(s, give(), false)).toBe(null);
    // Bound to a place: that place, once it is known.
    expect(questGround(s, give({ at: "greek-gate" }), false)).toBe(
      "greek-gate",
    );
    expect(questGround(s, give({ at: "greek-gate" }), false, () => false)).toBe(
      null,
    );
    // A held thing with no step still stands where the player is.
    expect(questGround(s, { ...give(), step: null }, false)).toBe("greek-gate");
  });

  it("shows the carved box, not the place here, for a home not yet found", () => {
    // Cass carries the board at the station; the pavilion is still unknown.
    const s = baseCreateWorld();
    s.actors.orin.place = "pond";
    s.items.board.holder = "orin";
    const bring = {
      actor: "orin",
      kind: "item",
      target: "board",
      step: { verb: "bring", at: "pavilion" },
    };
    const unknown = (id) => id !== "pavilion";
    expect(questGround(s, bring, false, unknown)).toBe(null);
    expect(questBox(bring, unknown)).toBe(true);
    // Once found, the card shows the home itself, wherever Cass stands.
    expect(questGround(s, bring, false)).toBe("pavilion");
    expect(questBox(bring)).toBe(false);
    // A step with a recipient shows the recipient in that slot instead.
    const give = {
      ...bring,
      step: { verb: "give", to: "moth", at: "pavilion" },
    };
    expect(questBox(give, unknown)).toBe(false);
    // A quest with no place keeps the rule it had.
    expect(questBox({ ...bring, step: null }, unknown)).toBe(false);
    expect(questGround(s, { ...bring, step: null }, false, unknown)).toBe(
      "pond",
    );
  });

  it("names a gift by its verb and takes its parts' highest tier", () => {
    const s = createWorld();
    const quest = {
      actor: "vale",
      kind: "item",
      target: "greek-decree",
      step: { verb: "give", to: "greek-guard" },
    };
    // The label is the verb; the caption is the card's accessible name.
    expect(questVerb(s, quest)).toBe("Give");
    expect(questCaption(quest)).toBe(
      `Give ${nameOf("greek-decree")} to The Gate Guard`,
    );
    const top = Math.max(
      cardLevel(s, "greek-decree"),
      cardLevel(s, "greek-guard"),
    );
    expect(questTier(quest, s).id).toBe(levelTier(top).id);
    expect(questTier(quest, s).id).not.toBe("common");
    // Parts not yet found give no colour away.
    expect(questTier(quest, s, () => false).id).toBe("common");
  });

  it("shows the player's want in the rules' words, covered until uncovered", () => {
    const s = createWorld();
    const quest = questCard(s);
    expect(quest).toMatchObject({
      actor: "vale",
      kind: "item",
      target: "lamp",
    });
    expect(questCaption(quest)).toBe("Hold Lamp");
    expect(questCaption(quest, true)).toBe("Find something");
  });

  it("explains an undiscovered destination without naming it", () => {
    const s = createWorld();
    const quest = { ...questCard(s), kind: "place", target: "clearing" };
    expect(questCaption(quest, true)).toBe("Discover somewhere");
    expect(questCaption(quest)).toBe("Go to Forest Clearing");
    expect(questVerb(s, quest, true)).toBe("Discover");
  });

  it("keeps a Find step short while naming its known place", () => {
    const quest = {
      ...questCard(createWorld()),
      level: 3,
      step: { verb: "find" },
    };
    expect(questCaption(quest, true)).toBe("Level III: Find something");
    quest.step.at = "pond";
    expect(questCaption(quest, true)).toBe(
      "Level III: Find something at Black pond",
    );
  });

  it("uses the visible place verb for covered, known, and visited destinations", () => {
    const s = createWorld();
    const quest = { ...questCard(s), kind: "place", target: "clearing" };
    const caption = (covered) =>
      questCaption(quest, covered, questVerb(s, quest, covered));
    expect(caption(true)).toBe("Discover somewhere");
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
      `Level III: Rest ${PLACE}`,
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
    expect(questCaption(quest, true)).toBe("Meet someone");
    expect(questCaption(quest)).toBe("Talk with Pip");
  });

  it("keeps the homecoming action and home when its belonging is covered", () => {
    const quest = {
      ...questCard(createWorld()),
      actor: "mara",
      target: "mask",
      story: true,
      step: { verb: "bring", at: "theatre" },
    };
    expect(questCaption(quest, true)).toBe(
      "Find something, and bring it to Paper theatre",
    );
    expect(questCaption(quest)).toBe("Bring Theatre mask to Paper theatre");
  });

  it("names the homecoming item and home only after each card is revealed", () => {
    const quest = {
      ...questCard(createWorld()),
      actor: "rue",
      target: "routes",
      story: true,
      step: { verb: "bring", at: "train" },
    };
    const revealed = new Set();
    const caption = () =>
      questCaption(quest, false, null, (id) => revealed.has(id));
    expect(caption()).toBe(`Find something, and bring it ${PLACE}`);
    revealed.add("routes");
    expect(caption()).toBe(`Bring Route board ${PLACE}`);
    revealed.add("train");
    expect(caption()).toBe("Bring Route board to Between-hours carriage");
    revealed.delete("routes");
    expect(caption()).toBe(
      "Find something, and bring it to Between-hours carriage",
    );
  });

  it("checks the recipient and place of an item quest separately", () => {
    const quest = {
      ...questCard(createWorld()),
      step: { verb: "bring", to: "moth", at: "pond" },
    };
    expect(questCaption(quest, false, null, (id) => id !== "moth")).toBe(
      `Bring Lamp to ${PERSON} at Black pond`,
    );
    expect(questCaption(quest, false, null, (id) => id !== "pond")).toBe(
      `Bring Lamp to Pip ${PLACE}`,
    );
  });

  it("keeps level and step context while covering only the target", () => {
    const quest = {
      ...questCard(createWorld()),
      level: 3,
      step: { verb: "bring", to: "moth", at: "pond" },
    };
    expect(questCaption(quest, true)).toBe(
      "Level III: Find something, and bring it to Pip at Black pond",
    );
    expect(questCaption(quest)).toBe(
      "Level III: Bring Lamp to Pip at Black pond",
    );
    expect(
      questCaption(
        { ...quest, kind: "place", target: "pond", step: { verb: "rest" } },
        true,
      ),
    ).toBe(`Level III: Rest ${PLACE}`);
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

  it("names a rest step Rest once the player stands at its sanctuary (#2255)", () => {
    const s = createWorld();
    s.actors.vale.place = "greek-sanctuary";
    s.actors.vale.visited = ["greek-sanctuary"];
    const rest = {
      ...questCard(s),
      kind: "place",
      target: "greek-sanctuary",
      step: { verb: "rest" },
    };
    expect(questVerb(s, rest)).toBe("Rest");
    expect(questCaption(rest, false, questVerb(s, rest))).toBe(
      "Rest at The Hillside Sanctuary",
    );
    // Away from it, the card still shows the way there.
    s.actors.vale.place = "greek-palace";
    expect(questVerb(s, rest)).toBe("Go to");
    expect(questCaption(rest, false, questVerb(s, rest))).toBe(
      "Go to The Hillside Sanctuary and rest there",
    );
  });

  it("places the quest card after the player's avatar and belongings (#2295)", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.items["greek-funeral-cloth"].holder = "vale";
    const ids = [questId()];
    expect(ids).toEqual(["quest:0"]);
    const hand = handWithQuest(availableCards(s), s, ids);
    expect(hand.filter(isQuestId)).toEqual(ids);
    const at = hand.indexOf("vale");
    expect(hand.slice(at + 1, at + 3).sort()).toEqual([
      "greek-funeral-cloth",
      "lamp",
    ]);
    expect(hand[at + 3]).toBe(ids[0]);
    // Drawn again it stays put, and with no quest the hand holds none.
    expect(handWithQuest(hand, s, ids).filter(isQuestId)).toEqual(ids);
    expect(handWithQuest(hand, s).some(isQuestId)).toBe(false);
  });

  it("shows the one held quest", () => {
    const s = createWorld();
    expect(questCards(s).map((q) => [q.index, q.target])).toEqual([
      [0, "lamp"],
    ]);
    expect(questCard(s).target).toBe("lamp");
    s.actors.vale.want = null;
    expect(questCards(s)).toEqual([]);
  });

  it("drops the card when the rules meet the quest, paying on that play", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.lamp.holder = "attic";
    s.actors.vale.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    expect(questCards(s).map((q) => q.target)).toEqual(["pond"]);
    const xp = s.actors.vale.xp;
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "move" && a.target === "pond"),
    ).state;
    // Nothing is sealed or left to claim: the card is gone, the XP is paid.
    expect(questCards(s)).toEqual([]);
    expect(s.actors.vale.xp).toBe(xp + 1);
    expect(
      legalActions(s).some((a) => ["claim", "focus"].includes(a.kind)),
    ).toBe(false);
  });

  it("drops a discarded quest without paying", () => {
    let s = createWorld();
    s.actors.vale.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "drop" && !a.item),
    ).state;
    expect(questCards(s)).toEqual([]);
  });

  it("shows one quest card for each quest held through a long run", () => {
    let s = createWorld();
    for (let turn = 0; turn < 400; turn++) {
      const actions = legalActions(s);
      s = play(s, actions[(turn * 7919) % actions.length]).state;
      const cards = questCards(s);
      expect(cards.length).toBeLessThanOrEqual(
        1 + (s.actors.vale.under?.length ?? 0),
      );
      for (const quest of cards) {
        expect(questCaption(quest)).toMatch(/^[A-Z]/);
        expect(typeof questNear(s, quest)).toBe("boolean");
      }
    }
    expect(validateWorld(s)).toBe(s);
  });
});
