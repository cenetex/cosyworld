import { actorQuests } from "./quests.mjs";
import { availableCards } from "./cards.mjs";
import { rootHolder, things, people, currentActor } from "./world.mjs";

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

// Stable collection keys belong to the save; card IDs only identify the view.
export const isQuestCard = (id) =>
  id === QUEST_CARD || (typeof id === "string" && id.startsWith("quest-card:"));

export function questCards(world, actor = currentActor(world)) {
  return actorQuests(world, actor).map((record) => {
    const program = record.program;
    const [title, purpose, art] =
      authored[program.id] ||
      situations[program.generated?.situation] ||
      (program.generated?.solo
        ? [
            "A moment of my own",
            "There is room here for a small discovery.",
            "lamp",
          ]
        : [
            program.name || "A wish",
            program.purpose || "Something worth pursuing.",
            "cloth",
          ]);
    return {
      key: record.key,
      actor,
      title,
      purpose,
      art,
      status: record.status,
      step: record.step,
      steps: record.totalSteps ?? program.steps?.length ?? 0,
    };
  });
}

export function playerQuest(world) {
  return questCards(world).find((quest) => quest.status === "active") || null;
}

export function fulfilledPlayerQuest(before, after) {
  const previous = new Map(
    questCards(before).map((quest) => [quest.key, quest]),
  );
  const fulfilled = questCards(after).find(
    (quest) =>
      quest.status === "fulfilled" &&
      previous.has(quest.key) &&
      previous.get(quest.key).status !== "fulfilled",
  );
  return fulfilled || null;
}

export function questCardId(world, quest, notice = null) {
  if (
    quest.actor === currentActor(world) &&
    quest.key === (notice || playerQuest(world))?.key
  )
    return QUEST_CARD;
  return `quest-card:${encodeURIComponent(quest.actor)}:${encodeURIComponent(quest.key)}`;
}

export function questForCard(world, id, notice = null) {
  if (id === QUEST_CARD) return notice || playerQuest(world);
  if (!isQuestCard(id)) return null;
  const [, encodedActor] = id.split(":");
  let actor;
  try {
    actor = decodeURIComponent(encodedActor);
  } catch {
    return null;
  }
  if (!world.actors[actor]) return null;
  return (
    questCards(world, actor).find(
      (quest) => questCardId(world, quest, notice) === id,
    ) || null
  );
}

export function questHand(world, notice = null) {
  const cards = availableCards(world);
  for (let index = 0; index < cards.length; index++) {
    const actor = cards[index];
    if (!people[actor]) continue;
    let deck = questCards(world, actor);
    if (actor === currentActor(world) && notice)
      deck = [notice, ...deck.filter((quest) => quest.key !== notice.key)];
    let end = index + 1;
    while (things[cards[end]] && rootHolder(world, cards[end]) === actor) end++;
    const ids = deck.map((quest) => questCardId(world, quest, notice));
    cards.splice(end, 0, ...ids);
    index = end + ids.length - 1;
  }
  return cards;
}
