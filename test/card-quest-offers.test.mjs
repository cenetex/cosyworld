import { expect, it } from "vitest";
import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards as journey } from "./journeys/quest-cards.mjs";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import {
  asleepReason,
  availableCards,
  cardActions,
  cardPlay,
  cardType,
  offerCards,
  offerOf,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  handWithQuest,
  isQuestId,
  offerQuest,
  questCaption,
  questId,
  questVerb,
} from "../v2/card-game/quest-card.mjs";

const worlds = journeyWorlds(journey);
const clone = (world) => decodeSave(encodeSave(world));
const OFFER = "quest:from:moth";

it("tells the held quest's id from the offers' ids", () => {
  expect(isQuestId(questId())).toBe(true);
  for (const id of [OFFER, "quest:box:greek-gate", "quest:home:x", "quest:level"])
    expect(isQuestId(id)).toBe(false);
  expect(isQuestId("quest:1")).toBe(false);
});

it("keeps the offers in the hand and drops only a stale held card", () => {
  const hand = ["vale", "lamp", "pond", OFFER, "quest:level"];
  expect(handWithQuest(hand, worlds.told, [])).toEqual(hand);
  expect(handWithQuest([...hand, questId()], worlds.told, [])).toEqual(hand);
  const held = handWithQuest(hand, worlds.told, [questId()]);
  expect(held).toContain(questId());
  expect(held).toContain(OFFER);
});

it("lays every offer on the table as a quest card", () => {
  const world = worlds.told;
  expect(offerCards(world)).toContain(OFFER);
  expect(availableCards(world)).toContain(OFFER);
  expect(cardType(OFFER)).toBe("quest");
  const offer = offerOf(world, OFFER);
  expect(offer).toMatchObject({ kind: "resident", label: "Accept quest", blocked: null });
});

it("draws an offer's face from its want, in the held quest's own words", () => {
  const world = worlds.told;
  const quest = offerQuest(world, offerOf(world, OFFER));
  expect(quest).toMatchObject({ key: OFFER, kind: "item", target: "lamp", level: null });
  const verb = questVerb(world, quest, false);
  expect(questCaption(quest, false, verb, () => true)).toBe("Give Lamp to Pip");
});

it("keeps a name the player has not uncovered hidden on the face", () => {
  const world = worlds.told;
  const quest = offerQuest(world, offerOf(world, OFFER));
  const covered = questCaption(quest, true, questVerb(world, quest, true), (id) => id !== "lamp");
  expect(covered).not.toMatch(/lamp/iu);
  expect(covered).toMatch(/something/u);
  const hiddenRecipient = questCaption(quest, false, "Give", (id) => id !== "moth");
  expect(hiddenRecipient).not.toMatch(/Pip/u);
});

it("a chosen offer gives exactly one play, labelled by the offer", () => {
  const world = worlds.told;
  const { actions } = cardActions(world, [OFFER]);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ kind: "take", offer: OFFER });
  expect(playLabel(actions[0], world)).toBe("Accept quest");
  expect(asleepReason(world, [OFFER])).toBeNull();
  const level = clone(worlds.met);
  expect(playLabel(cardActions(level, ["quest:level"]).actions[0], level)).toBe(
    "Take level up quest",
  );
});

it("a blocked offer has no play and its reason is the one button's label", () => {
  const world = clone(worlds.told);
  world.actors.vale.want = newWant("item", "cloth", world.turn);
  const offer = offerOf(world, OFFER);
  expect(offer.blocked).toBe("Finish or discard your quest first");
  const chosen = cardActions(world, [OFFER]);
  expect(chosen.actions).toEqual([]);
  expect(cardPlay(world, [OFFER]).action).toBeUndefined();
  expect(asleepReason(world, [OFFER])).toBe(offer.blocked);
  expect(asleepReason(world, [OFFER])).not.toMatch(/asleep/iu);
});
