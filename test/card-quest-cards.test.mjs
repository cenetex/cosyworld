import {
  collectionCards,
  registerPersonalQuest,
  focusQuest,
  clearQuestFocus,
} from "../v2/card-game/shared-quests.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  decodeSave,
  places,
  things,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  actorQuests,
  installQuestCollection,
  ensureCollectedQuest,
  pursueQuest,
} from "../v2/card-game/quests.mjs";
import {
  QUEST_CARD,
  playerQuest,
  fulfilledPlayerQuest,
  questHand,
  questCards,
  questHistoryCards,
  questCardId,
  questForCard,
  isQuestCard,
  STORY_QUEST_CARDS,
  fulfilledQuests,
} from "../v2/card-game/quest-cards.mjs";
const fresh = (opening = true) =>
  enableMotives(createWorld({ opening }), {
    questPrograms: true,
    personalQuests: true,
  });
const act = (world, kind) => {
  const result = play(
    world,
    legalActions(world).find((action) => action.kind === kind),
  );
  expect(result.ok).toBe(true);
  return result.state;
};
function collect(world, actor, status = "pending") {
  installQuestCollection(world, actor);
  const collection = world.life.actors[actor].collection;
  const source = collectionCards(world, actor)[0];
  const record = {
    ...structuredClone(source),
    key: `${actor}:quest:${collection.next++}`,
    createdTurn: world.turn,
    completedTurn: status === "fulfilled" ? world.turn : null,
    origin: {
      kind: "gift",
      other: actor === "vale" ? "moth" : "vale",
      item: "lamp",
      place: "station",
      turn: world.turn,
    },
  };
  registerPersonalQuest(world, actor, record);
  collection.cards.push(record.key);
  if (status === "active") {
    collection.active = record.key;
    focusQuest(world, actor, record.key);
  }
  return record;
}
describe("collected quest cards", () => {
  it("keeps the active quest and collected cards after the avatar's carried items", () => {
    const world = fresh();
    const pending = collect(world, "vale");
    collect(world, "vale", "fulfilled");
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "lamp";
    const deck = questCards(world);
    expect(deck.map((quest) => quest.status)).toEqual(["active", "pending"]);
    const hand = questHand(world);
    const cardIds = deck.map((quest) => questCardId(world, quest));
    expect(hand.filter(isQuestCard)).toEqual(cardIds);
    expect(hand.indexOf(QUEST_CARD)).toBeGreaterThan(hand.indexOf("oil"));
    expect(hand.indexOf(QUEST_CARD)).toBeGreaterThan(hand.indexOf("cloth"));
    expect(questForCard(world, cardIds[1]).key).toBe(pending.key);
    expect(playerQuest(world)).toMatchObject({
      title: "First light",
      purpose: "A little warmth might wake this empty room.",
      art: "lamp",
    });
  });
  it("keeps the active card's identity through ordinary turns and a save", () => {
    const world = fresh();
    expect(playerQuest(decodeSave(encodeSave(world)))).toEqual(
      playerQuest(world),
    );
    expect(playerQuest(act(world, "wait"))).toEqual(playerQuest(world));
  });
  it("retains a fulfilled card in the collection after its completion notice", () => {
    const before = fresh(),
      after = act(before, "light");
    const completed = fulfilledPlayerQuest(before, after);
    expect(completed).toMatchObject({
      key: playerQuest(before).key,
      status: "fulfilled",
    });
    expect(questCards(after)).toContainEqual(completed);
    expect(
      questHand(after, completed).filter(
        (id) => questForCard(after, id, completed)?.key === completed.key,
      ),
    ).toHaveLength(1);
    expect(
      questHand(after).some(
        (id) => questForCard(after, id)?.key === completed.key,
      ),
    ).toBe(true);
    expect(fulfilledPlayerQuest(before, act(before, "wait"))).toBeNull();
  });
  it("shows each visible avatar's own deck after their belongings", () => {
    const world = fresh(false);
    world.actors.moth.place = world.actors.vale.place;
    world.items.bell.holder = "moth";
    collect(world, "moth");
    const hand = questHand(world);
    const cards = questCards(world, "moth").map((quest) =>
      questCardId(world, quest),
    );
    expect(cards).toHaveLength(2);
    expect(hand.indexOf(cards[0])).toBeGreaterThan(hand.indexOf("moth"));
    expect(hand.indexOf(cards[0])).toBeGreaterThan(hand.indexOf("bell"));
    expect(cards.every((id) => questForCard(world, id)?.actor === "moth")).toBe(
      true,
    );
  });
  it("preserves card identity and progress when attention changes", () => {
    const world = fresh();
    const pending = collect(world, "vale");
    const old = playerQuest(world);
    pursueQuest(world, "vale", pending.key);
    const deck = questCards(world);
    expect(deck[0].key).toBe(pending.key);
    expect(deck.find((q) => q.key === old.key)).toMatchObject({
      status: "pending",
      step: old.step,
    });
    expect(fulfilledPlayerQuest(fresh(), world)).toBeNull();
    expect(new Set(questHand(world).filter(isQuestCard)).size).toBe(2);
  });
  it("uses the selected human's collection", () => {
    const world = fresh(false);
    world.playerActorId = "mara";
    const pending = collect(world, "mara");
    expect(playerQuest(world).actor).toBe("mara");
    const card = questCards(world).find((quest) => quest.key === pending.key);
    expect(questForCard(world, questCardId(world, card))).toEqual(card);
    expect(actorQuests(world, "vale")[0].key).not.toBe(playerQuest(world).key);
  });
  it("safely handles stale or malformed card references", () => {
    const world = fresh();
    for (const id of [
      "vale",
      "quest-card:%xx:x",
      "quest-card:missing:x",
      "quest-card:vale:missing",
    ])
      expect(questForCard(world, id)).toBeNull();
  });
});

describe("Greek cards in the collected stack", () => {
  it("keeps active personal focus above story cards and retains completed labels and art", () => {
    for (const branch of ["burial", "concession", "refusal", "exposure"]) {
      const world = openingFixture(branch).closed;
      ensureCollectedQuest(world, "vale", places, things);
      const pending = collectionCards(world, "vale").find(
        (q) => q.completedTurn === null,
      );
      expect(pursueQuest(world, "vale", pending.key)).toBe(true);
      const cards = questCards(world);
      expect(cards[0].key).toBe(playerQuest(world).key);
      const story = questHistoryCards(world).find(
        (q) => q.id === STORY_QUEST_CARDS[1],
      );
      expect(story).toMatchObject({
        status: "fulfilled",
        singleLine: true,
        art: "greek-funeral-cloth",
        completion:
          { refusal: "Declined", exposure: "Reported" }[branch] || "Fulfilled",
      });
      const hand = questHand(world);
      expect(hand).toContain(QUEST_CARD);
      expect(questHistoryCards(decodeSave(encodeSave(world)))).toContainEqual(
        story,
      );
      world.log = [];
      expect(questCards(decodeSave(encodeSave(world)))).toEqual(cards);
    }
  });
  it("retains the first courtyard report when a second report is collected", () => {
    const states = openingFixture("concession");
    const original = questHistoryCards(states.permissionShared).find(
      (q) => q.id === STORY_QUEST_CARDS[2],
    );
    const cards = questHistoryCards(states.closed);
    const first = cards.find((q) => q.key === original.key);
    const second = cards.find((q) => q.key === original.key + ":grave");
    expect(first).toMatchObject({
      status: "fulfilled",
      completion: "Shared",
      art: original.art,
    });
    expect(second).toMatchObject({ status: "fulfilled", completion: "Shared" });
    expect(questCardId(states.closed, first)).not.toBe(
      questCardId(states.closed, second),
    );
    expect(questHistoryCards(decodeSave(encodeSave(states.closed)))).toEqual(
      cards,
    );
    expect(questCards(states.closed).length).toBeLessThanOrEqual(2);
  });
});

it("announces the first courtyard completion when the next report opens in the same turn", () => {
  const states = openingFixture("concession", { reportFirst: false });
  const before = states.buried;
  const after = states.permissionShared;
  const firstKey = "greek-drama:" + STORY_QUEST_CARDS[2];
  expect(fulfilledQuests(before, after)).toContainEqual(
    expect.objectContaining({
      key: firstKey,
      status: "fulfilled",
      completion: "Shared",
    }),
  );
});
