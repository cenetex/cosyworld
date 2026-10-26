import { packDefinition } from "./pack-registry.mjs";
import { recitalPoem } from "./pack-recital.mjs";
import { actorQuests } from "./quests.mjs";
import { availableCards } from "./cards.mjs";
import { rootHolder, things, people, currentActor } from "./world.mjs";

export const QUEST_CARD = "player-quest";

export const STORY_QUEST_CARDS = [
  "story-quest-greek-table",
  "story-quest-greek-burial",
  "story-quest-greek-courtyard",
];

export function openingPoem(world) {
  return recitalPoem(world, packDefinition("greek-drama"));
}

const storyLines = [
  "A place beside the bread.",
  "Her brother waits for earth.",
  "What words will you bring home?",
];

// Card lines stay short and steady; saved choices determine their completion.
export function storyQuests(world) {
  const state = world.packs?.["greek-drama"];
  if (!state) return [];
  const flags = state.flags || {},
    met = state.met || {},
    response = state.choices?.["greek-theban-response"],
    buried = flags["greek-burial-performed"] === true,
    returned = flags["greek-water-returned"] === true,
    publicOutcome = flags[`greek-${response}-public`] === true,
    graveReturn = response === "concession" && buried && publicOutcome,
    graveShared = flags["greek-permitted-burial-public"] === true;
  const card = (index, art, resolved, completion = "Fulfilled") => ({
    id: STORY_QUEST_CARDS[index],
    key: `greek-drama:${STORY_QUEST_CARDS[index]}${index === 2 && graveReturn ? ":grave" : ""}`,
    title: storyLines[index],
    purpose: storyLines[index],
    singleLine: true,
    story: true,
    actor: currentActor(world),
    status: resolved ? "fulfilled" : "pending",
    art,
    resolved,
    completion,
  });
  const quests = [];
  if (Object.hasOwn(met, "greek-baker") || returned)
    quests.push(card(0, "greek-water-jar", returned));
  if (
    Object.hasOwn(met, "greek-antigone") ||
    flags["greek-decree-known"] ||
    response ||
    buried
  ) {
    const completion = { refusal: "Declined", exposure: "Reported" }[response];
    quests.push(
      card(1, "greek-funeral-cloth", buried || Boolean(completion), completion),
    );
  }
  if (response) {
    const resolved = publicOutcome && (!graveReturn || graveShared);
    quests.push(card(2, "greek-bread", resolved, "Shared"));
  }
  return quests;
}

export function activeQuests(world) {
  const personal = playerQuest(world);
  return [
    ...storyQuests(world).filter((quest) => !quest.resolved),
    ...(personal ? [{ ...personal, id: QUEST_CARD }] : []),
  ];
}

export function fulfilledQuests(before, after) {
  const previous = new Map(
    questCards(before).map((quest) => [quest.key, quest]),
  );
  return questCards(after)
    .filter(
      (quest) =>
        quest.status === "fulfilled" &&
        previous.has(quest.key) &&
        previous.get(quest.key).status !== "fulfilled",
    )
    .map((quest) => ({
      ...quest,
      id: quest.story ? questCardId(after, quest) : QUEST_CARD,
      completion: quest.completion || "Fulfilled",
    }));
}

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
  id === QUEST_CARD ||
  STORY_QUEST_CARDS.includes(id) ||
  (typeof id === "string" && id.startsWith("quest-card:"));

function personalQuestCards(world, actor = currentActor(world)) {
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

// Pack receipts retain story cards through reload and log pruning. A second
// courtyard report has its own identity while the first stays in the collection.
export function questCards(world, actor = currentActor(world)) {
  const personal = personalQuestCards(world, actor);
  const stories =
    actor === currentActor(world)
      ? storyQuests(world).map((quest) => ({
          ...quest,
          actor,
          status: quest.resolved ? "fulfilled" : "pending",
          story: true,
        }))
      : [];
  const grave = stories.find((quest) => quest.key.endsWith(":grave"));
  if (grave)
    stories.push({
      ...grave,
      id: undefined,
      key: grave.key.slice(0, -6),
      resolved: true,
      status: "fulfilled",
    });
  return [
    ...personal.filter((quest) => quest.status === "active"),
    ...personal.filter((quest) => quest.status === "pending"),
    ...stories.filter((quest) => quest.status === "pending"),
    ...personal.filter((quest) => quest.status === "fulfilled"),
    ...stories.filter((quest) => quest.status === "fulfilled"),
  ];
}

export function playerQuest(world) {
  return (
    personalQuestCards(world).find((quest) => quest.status === "active") || null
  );
}

export function fulfilledPlayerQuest(before, after) {
  const previous = new Map(
    personalQuestCards(before).map((quest) => [quest.key, quest]),
  );
  const fulfilled = personalQuestCards(after).find(
    (quest) =>
      quest.status === "fulfilled" &&
      previous.has(quest.key) &&
      previous.get(quest.key).status !== "fulfilled",
  );
  return fulfilled || null;
}

export function questCardId(world, quest, notice = null) {
  if (quest.id) return quest.id;
  if (
    quest.actor === currentActor(world) &&
    quest.key ===
      (notice?.story ? playerQuest(world) : notice || playerQuest(world))?.key
  )
    return QUEST_CARD;
  return `quest-card:${encodeURIComponent(quest.actor)}:${encodeURIComponent(quest.key)}`;
}

export function questForCard(world, id, notice = null) {
  if (id === QUEST_CARD)
    return notice?.story ? playerQuest(world) : notice || playerQuest(world);
  if (STORY_QUEST_CARDS.includes(id))
    return questCards(world).find((quest) => quest.id === id) || null;
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
    if (
      actor === currentActor(world) &&
      notice &&
      !deck.some((quest) => quest.key === notice.key)
    )
      deck.push(notice);
    let end = index + 1;
    while (things[cards[end]] && rootHolder(world, cards[end]) === actor) end++;
    const ids = deck.map((quest) => questCardId(world, quest, notice));
    cards.splice(end, 0, ...ids);
    index = end + ids.length - 1;
  }
  return cards;
}
