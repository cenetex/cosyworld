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

// Version-one verses are selected from committed choices, in their saved order.
// Keep these earned lines stable when adding later chapters to the poem.
const verses = {
  water: "I set the water by her hands.\nShe kept a loaf of bread for me.",
  permission: "Creon has granted this one grave.\nHer brother waits for earth.",
  burial:
    "I laid her brother in the earth.\nThe king's words crossed the wind.",
  permittedBurial:
    "Creon gave leave for this one grave.\nI laid her brother in the earth.",
  refusal: "I told her I would turn away.\nHer brother waited by the wall.",
  exposure:
    "I gave the guard the hidden plan.\nHe held it with the king's command.",
  courtyardBurial:
    "I spoke of earth beside her table.\nDione heard me through.",
  courtyardPermission:
    "I spoke the promise of a grave.\nHis body waited in the sun.",
  courtyardPermissionAfterBurial:
    "I told her of the king's consent.\nShe heard the leave that he had given.",
  courtyardRefusal:
    "I told her how I turned away.\nShe kept a place beside her table.",
  courtyardExposure:
    "I told her what the guard had heard.\nMy words lay open on the table.",
  courtyardGrave:
    "The grave I promised holds him now.\nI brought that word to Dione.",
};
const storyTitles = [
  "A place at the table",
  "Before the burial",
  "What the courtyard knows",
];
const poemEvents = {
  "greek-return-water-jar": [0, "water"],
  "greek-petition-burial": [1, "permission"],
  "greek-perform-burial": [1, "burial"],
  "greek-perform-permitted-burial": [1, "permittedBurial"],
  "greek-decline-burial": [1, "refusal"],
  "greek-report-plan": [1, "exposure"],
  "greek-courtyard-burial": [2, "courtyardBurial"],
  "greek-courtyard-concession": [2, "courtyardPermission"],
  "greek-courtyard-refusal": [2, "courtyardRefusal"],
  "greek-courtyard-exposure": [2, "courtyardExposure"],
  "greek-courtyard-permitted-burial": [2, "courtyardGrave"],
};

export function openingPoem(world) {
  const receipts = world.packs?.["greek-drama"]?.receipts || {};
  const stanzas = Object.entries(receipts)
    .filter(([id]) => Object.hasOwn(poemEvents, id))
    .sort((a, b) => a[1] - b[1])
    .map(([id, turn]) => {
      const [index, verse] = poemEvents[id];
      // A later rite cannot rewrite what Dione heard on an earlier visit.
      const key =
        verse === "courtyardPermission" &&
        receipts["greek-perform-permitted-burial"] < turn
          ? "courtyardPermissionAfterBurial"
          : verse;
      return {
        id,
        turn,
        questId: STORY_QUEST_CARDS[index],
        title: storyTitles[index],
        lines: verses[key].split("\n"),
      };
    });
  return { title: "Before the Burial", stanzas };
}

// Cards and the poem share the same words and the same saved choice receipts.
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
  const earned = openingPoem(world).stanzas;
  const lastVerse = (index) =>
    earned
      .findLast((stanza) => stanza.questId === STORY_QUEST_CARDS[index])
      ?.lines.join("\n");
  const card = (index, purpose, art, resolved, completion = "Fulfilled") => ({
    id: STORY_QUEST_CARDS[index],
    key: `greek-drama:${STORY_QUEST_CARDS[index]}${index === 2 && graveReturn ? ":grave" : ""}`,
    title: storyTitles[index],
    purpose,
    art,
    resolved,
    completion,
  });
  const quests = [];
  if (Object.hasOwn(met, "greek-baker") || returned)
    quests.push(
      card(
        0,
        returned
          ? lastVerse(0)
          : "A jar of water for her hands.\nA place beside her bread.",
        "greek-water-jar",
        returned,
      ),
    );
  if (
    Object.hasOwn(met, "greek-antigone") ||
    flags["greek-decree-known"] ||
    response ||
    buried
  ) {
    const completion = { refusal: "Declined", exposure: "Reported" }[response];
    quests.push(
      card(
        1,
        lastVerse(1) ||
          "Antigone stands beyond the gate.\nHer brother waits for earth.",
        "greek-funeral-cloth",
        buried || Boolean(completion),
        completion,
      ),
    );
  }
  if (response) {
    const resolved = publicOutcome && (!graveReturn || graveShared);
    quests.push(
      card(
        2,
        resolved
          ? lastVerse(2)
          : graveReturn
            ? "Her brother rests beneath the earth.\nDione waits to hear of him."
            : "Dione keeps a place for me.\nWhat shall I bring beside the bread?",
        "greek-bread",
        resolved,
        "Shared",
      ),
    );
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
