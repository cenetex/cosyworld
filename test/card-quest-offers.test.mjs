import { expect, it } from "vitest";
import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards as journey } from "./journeys/quest-cards.mjs";
import { decodeSave, encodeSave, homeOf, legalActions } from "../v2/card-game/world.mjs";
import { heldOf, sleepQuest } from "../v2/card-game/want.mjs";
import {
  availableCards,
  cardActions,
  cardPlay,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  handWithQuest,
  isQuestId,
  offerCard,
  offerWords,
  questCaption,
  questCards,
  questId,
  questVerb,
} from "../v2/card-game/quest-card.mjs";

const worlds = journeyWorlds(journey);
const clone = (world) => decodeSave(encodeSave(world));
const OFFER = "quest:from:moth";

it("tells the held quest's id from an offer's id", () => {
  expect(isQuestId(questId())).toBe(true);
  for (const id of [OFFER, "quest:box:greek-gate", "quest:home:x", "quest:dream"])
    expect(isQuestId(id)).toBe(false);
  expect(isQuestId("quest:1")).toBe(false);
});

it("keeps the held quest's card with the hand and drops only a stale one", () => {
  const hand = ["vale", "lamp", "pond"];
  expect(handWithQuest(hand, worlds.told, [])).toEqual(hand);
  expect(handWithQuest([...hand, questId()], worlds.told, [])).toEqual(hand);
  const held = handWithQuest(hand, worlds.told, [questId()]);
  expect(held).toContain(questId());
  expect(held.indexOf(questId())).toBeGreaterThan(held.indexOf("vale"));
});

it("lays the offer as its own card after Talk, held only once accepted", () => {
  const world = worlds.told;
  expect(heldOf(world.actors.vale)).toEqual([]);
  expect(availableCards(world).some((id) => id.startsWith("quest:"))).toBe(false);
  expect(offerCard(world)).toMatchObject({ offer: "moth", kind: "item", target: "lamp", full: false });
  const accept = legalActions(world).filter((a) => a.kind === "accept" && !a.box);
  expect(accept).toMatchObject([{ target: "moth", cards: [] }]);
  expect(playLabel(accept[0], world)).toBe("Accept");
  expect(cardActions(world, ["moth"]).actions.some((a) => a.kind === "accept")).toBe(false);
  expect(heldOf(worlds.accepted.actors.vale).map((w) => w.from)).toEqual([OFFER]);
  expect(offerCard(worlds.accepted)).toBeNull();
});

it("words the offer as the resident asking, naming nothing undiscovered", () => {
  const quest = offerCard(worlds.told);
  expect(offerWords(quest)).toBe("Pip asks for the Lamp");
  expect(offerWords(quest, (id) => id !== "lamp")).toBe(
    "Pip asks for something you haven't found",
  );
  const escort = {
    ...quest,
    kind: "person",
    target: "moth",
    step: { verb: "bring", at: "attic" },
  };
  expect(offerWords(escort)).toMatch(/^Pip asks you to bring Pip to /u);
  expect(offerWords(escort, (id) => id !== "attic")).not.toMatch(/attic/iu);
});

it("draws the held quest's face from its want, in the rules' own words", () => {
  const world = worlds.accepted;
  const [quest] = questCards(world);
  expect(quest).toMatchObject({ kind: "item", target: "lamp", level: null });
  const verb = questVerb(world, quest, false);
  expect(questCaption(quest, false, verb, () => true)).toBe("Give Lamp to Pip");
});

it("keeps a name the player has not uncovered hidden on the face", () => {
  const world = worlds.accepted;
  const [quest] = questCards(world);
  const covered = questCaption(quest, true, questVerb(world, quest, true), (id) => id !== "lamp");
  expect(covered).not.toMatch(/lamp/iu);
  expect(covered).toMatch(/something/u);
  const hiddenRecipient = questCaption(quest, false, "Give", (id) => id !== "moth");
  expect(hiddenRecipient).not.toMatch(/Pip/u);
});

it("gives a chosen card no accept play: the held quest's one button is Discard", () => {
  const world = worlds.accepted;
  expect(cardActions(world, [OFFER]).actions).toEqual([]);
  const drop = legalActions(world).filter((a) => a.kind === "drop" && !a.item);
  expect(drop).toHaveLength(1);
  expect(playLabel(drop[0], world)).toBe("Discard");
  const dreaming = clone(worlds.met);
  expect(sleepQuest(dreaming, "vale", { home: homeOf })).toBeTruthy();
  const free = legalActions(dreaming).find((a) => a.kind === "drop" && !a.item);
  expect(playLabel(free, dreaming)).toBe("Discard");
});

it("offers no play for a stale offer id, held quest or not", () => {
  const world = clone(worlds.told);
  expect(cardPlay(world, [OFFER]).action).toBeFalsy();
});
