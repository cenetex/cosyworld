import { programFor } from "./quests.mjs";
import { availableCards } from "./cards.mjs";
import { rootHolder, things, currentActor } from "./world.mjs";

export const QUEST_CARD = "player-quest";

// Card copy describes a wish. The rules and steps remain in the quest engine.
const authored = {
  "first-light": [
    "First light",
    "A little warmth might wake this empty room.",
    "lamp",
  ],
  "along-the-shore": [
    "Along the shore",
    "There may be company beyond the water.",
    "lamp",
  ],
  "borrowed-light": [
    "Borrowed light",
    "A borrowed warmth can bring strangers closer.",
    "lamp",
  ],
  "the-bell-below": [
    "The bell below",
    "Something beneath the stillness is waiting to be heard.",
    "bell",
  ],
};
const situations = {
  crossing: [
    "A path that remembers",
    "Perhaps this shore could feel a little less far away.",
    "lamp",
  ],
  answer: [
    "An answer in the quiet",
    "The quiet has something left to say.",
    "bell",
  ],
  delivery: [
    "A small kindness",
    "Someone's evening could be a little easier.",
    "oil",
  ],
  gathering: [
    "Room for company",
    "Warmth means more when it is shared.",
    "lamp",
  ],
  bargain: [
    "A little trust",
    "A small exchange could be the start of something.",
    "cloth",
  ],
};

export function playerQuest(world) {
  const program = programFor(world, currentActor(world));
  if (!program) return null;
  const [title, purpose, art] =
    authored[program.id] ||
    situations[program.generated?.situation] ||
    (program.generated?.solo
      ? [
          "A moment of my own",
          "There is room here for a small discovery.",
          "lamp",
        ]
      : situations.bargain);
  return {
    key: `${currentActor(world)}:${world.actors[currentActor(world)].progress.program}:${program.id}:${program.generated?.turn ?? "authored"}`,
    title,
    purpose,
    art,
  };
}

export function fulfilledPlayerQuest(before, after) {
  const quest = playerQuest(before);
  if (!quest || quest.key === playerQuest(after)?.key) return null;
  const receipt = after.log.find(
    (entry) =>
      entry.seq > (before.eventSeq || 0) &&
      entry.kind === "quest" &&
      entry.actorId === currentActor(before) &&
      entry.programIndex ===
        before.actors[currentActor(before)].progress.program &&
      entry.step + 1 === entry.program?.steps.length,
  );
  return receipt ? quest : null;
}

export function questHand(world, quest) {
  const cards = availableCards(world);
  if (!quest) return cards;
  let index = cards.indexOf(currentActor(world)) + 1;
  while (
    things[cards[index]] &&
    rootHolder(world, cards[index]) === currentActor(world)
  )
    index++;
  cards.splice(index, 0, QUEST_CARD);
  return cards;
}
