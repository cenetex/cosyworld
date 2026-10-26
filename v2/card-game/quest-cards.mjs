import { packDefinition } from "./pack-registry.mjs";
import { recitalPoem } from "./pack-recital.mjs";
import { programFor } from "./quests.mjs";
import { availableCards } from "./cards.mjs";
import { rootHolder, things, currentActor } from "./world.mjs";

export const QUEST_CARD = "player-quest";
export const STORY_QUEST_CARDS = [
  "story-quest-greek-table",
  "story-quest-greek-burial",
  "story-quest-greek-courtyard",
];
export const isQuestCard = (id) =>
  id === QUEST_CARD || STORY_QUEST_CARDS.includes(id);

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
  const active = new Set(
    storyQuests(before)
      .filter((q) => !q.resolved)
      .map((q) => q.key),
  );
  const personal = fulfilledPlayerQuest(before, after);
  return [
    ...storyQuests(after).filter((q) => q.resolved && active.has(q.key)),
    ...(personal
      ? [{ ...personal, id: QUEST_CARD, completion: "Fulfilled" }]
      : []),
  ];
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

export function questHand(world, quest = activeQuests(world)) {
  const cards = availableCards(world);
  const quests = Array.isArray(quest) ? quest : quest ? [quest] : [];
  if (!quests.length) return cards;
  let index = cards.indexOf(currentActor(world)) + 1;
  while (
    things[cards[index]] &&
    rootHolder(world, cards[index]) === currentActor(world)
  )
    index++;
  cards.splice(index, 0, ...quests.map((q) => q.id || QUEST_CARD));
  return cards;
}
