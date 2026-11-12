import { expect, it } from "vitest";
import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards as journey } from "./journeys/quest-cards.mjs";
import { decodeSave, encodeSave, legalActions } from "../v2/card-game/world.mjs";
import { heldOf } from "../v2/card-game/want.mjs";
import {
  availableCards,
  cardActions,
  cardPlay,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  handWithQuest,
  isQuestId,
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
  for (const id of [OFFER, "quest:box:greek-gate", "quest:home:x", "quest:level"])
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

it("lays no offer on the table: a standing offer is already held", () => {
  const world = worlds.told;
  expect(heldOf(world.actors.vale).map((w) => w.from)).toEqual([OFFER]);
  expect(availableCards(world).some((id) => id.startsWith("quest:"))).toBe(false);
  expect(legalActions(world).some((a) => a.kind === "take" && a.offer)).toBe(false);
});

it("draws the held quest's face from its want, in the rules' own words", () => {
  const world = worlds.told;
  const [quest] = questCards(world);
  expect(quest).toMatchObject({ kind: "item", target: "lamp", level: null });
  const verb = questVerb(world, quest, false);
  expect(questCaption(quest, false, verb, () => true)).toBe("Give Lamp to Pip");
});

it("keeps a name the player has not uncovered hidden on the face", () => {
  const world = worlds.told;
  const [quest] = questCards(world);
  const covered = questCaption(quest, true, questVerb(world, quest, true), (id) => id !== "lamp");
  expect(covered).not.toMatch(/lamp/iu);
  expect(covered).toMatch(/something/u);
  const hiddenRecipient = questCaption(quest, false, "Give", (id) => id !== "moth");
  expect(hiddenRecipient).not.toMatch(/Pip/u);
});

it("gives a chosen card no accept play: the held quest's one button is Discard", () => {
  const world = worlds.told;
  expect(cardActions(world, [OFFER]).actions).toEqual([]);
  const drop = legalActions(world).filter((a) => a.kind === "drop" && !a.item);
  expect(drop).toHaveLength(1);
  expect(playLabel(drop[0], world)).toBe("Discard");
  const level = clone(worlds.met);
  expect(heldOf(level.actors.vale)[0].quest).toBeTruthy();
  const costly = legalActions(level).find((a) => a.kind === "drop" && !a.item);
  expect(playLabel(costly, level)).toMatch(/^Discard \(−\d+ XP\)$/u);
});

it("offers no play for a stale offer id, held quest or not", () => {
  const world = clone(worlds.told);
  expect(cardPlay(world, [OFFER]).action).toBeFalsy();
});
