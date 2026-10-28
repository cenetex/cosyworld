import { questCarried, questFresh, questHolderActor } from "./quest-hands.mjs";
import { packDefinition } from "./pack-registry.mjs";
import { recitalPoem } from "./pack-recital.mjs";
import { questRecords, questStatus } from "./shared-quests.mjs";
import { questOfferFamily } from "./quest-offers.mjs";
import { actorQuests, alternatives } from "./quests.mjs";
import { availableCards } from "./cards.mjs";
import {
  rootHolder,
  things,
  people,
  places,
  currentActor,
  nameOf,
} from "./world.mjs";

export const QUEST_CARD = "player-quest";

export { STORY_QUEST_CARDS } from "./story-quests.mjs";
import {
  STORY_QUEST_CARDS,
  storyDefinitions,
  storyActors,
} from "./story-quests.mjs";

export function openingPoem(world) {
  return recitalPoem(world, packDefinition("greek-drama"));
}

export function storyQuests(world) {
  return storyQuestCards(world, currentActor(world)).filter(
    (quest) => !quest.historical,
  );
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
    questHistoryCards(before).map((quest) => [quest.key, quest]),
  );
  return questHistoryCards(after)
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
  const collected = actorQuests(world, actor);
  const keys = new Set(collected.map((record) => record.key));
  const held = questRecords(world).filter(
    (record) => record.holder.id === actor && !keys.has(record.key),
  );
  const records = [...collected, ...held].filter(
    (record) => record.mode !== "story",
  );
  return records.map((record) => {
    const program = record.program;
    const [title, purpose, art] =
      (program.generated?.situation === "introduction"
        ? [program.name, program.purpose, record.subjectActor || actor]
        : null) ||
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
    const status = record.status || questStatus(world, record);
    const focused =
      record.ongoing ||
      (record.holder
        ? world.quests.focus[actor] === record.key
        : status === "active");
    return {
      key: record.key,
      ...(record.ongoing ? { ongoing: true } : {}),
      completedTurn: record.completedTurn,
      expiresTurn:
        record.completedTurn === null ? null : record.completedTurn + 2,
      fading:
        record.completedTurn !== null && world.turn > record.completedTurn,
      actor,
      title: questOfferTitle(world, record, records, title),
      purpose,
      art: program.art || art,
      holder: record.holder || { kind: "avatar", id: actor },
      participants: record.participants || [actor],
      focused,
      status: ["fulfilled", "superseded"].includes(status)
        ? status
        : focused
          ? "active"
          : "pending",
      completion: {
        declined: "Declined",
        reported: "Reported",
        shared: "Shared",
      }[record.completion?.outcome],
      step: record.step,
      steps: record.totalSteps ?? program.steps?.length ?? 0,
    };
  });
}

// Distinct wishes can survive through focus, progress or sharing. Name their company.
function questOfferTitle(world, record, records, title) {
  const family = questOfferFamily(record.program);
  if (
    !family ||
    records.filter(
      (q) => questOfferFamily(q.program) === family && q.completedTurn === null,
    ).length < 2 ||
    record.completedTurn !== null
  )
    return title;
  const targets = alternatives(record.program.steps[0]);
  const companions = [
    ...new Set(targets.flatMap((target) => target.avatars)),
  ].sort();
  const locations = [
    ...new Set(targets.map((target) => target.location).filter(Boolean)),
  ].sort();
  const detail = companions.length
    ? companions.map((id) => world.actors[id]?.name || nameOf(id)).join(" & ")
    : locations.map((id) => nameOf(id)).join(" & ");
  return detail ? `${title} · ${detail}` : title;
}

function storyQuestCards(world, actor) {
  return storyDefinitions(world, true)
    .filter((definition) => {
      const record = world.quests?.records[definition.key];
      return record
        ? record.holder.id === actor || record.participants.includes(actor)
        : definition.holder.id === actor ||
            storyActors(world, definition).includes(actor);
    })
    .map((definition) => {
      const record = world.quests?.records[definition.key];
      return {
        ...definition,
        completedTurn: record?.completedTurn ?? null,
        expiresTurn:
          record?.completedTurn == null ? null : record.completedTurn + 2,
        fading:
          record?.completedTurn != null && world.turn > record.completedTurn,
        actor,
        id:
          actor === currentActor(world) && !definition.historical
            ? definition.id
            : undefined,
        participants: record?.participants || storyActors(world, definition),
        focused: world.quests?.focus[actor] === definition.key,
        step: record?.step ?? Number(definition.resolved),
        steps: 1,
      };
    });
}

// Pack receipts retain story cards through reload and log pruning. A second
// courtyard report has its own identity while the first stays in the collection.
export function questHistoryCards(world, actor = currentActor(world)) {
  const personal = personalQuestCards(world, actor);
  const stories = storyQuestCards(world, actor);
  return [
    ...personal.filter((quest) => quest.status === "active"),
    ...personal.filter((quest) => quest.status === "pending"),
    ...stories.filter((quest) => quest.status === "pending"),
    ...personal.filter((quest) => quest.status === "fulfilled"),
    ...personal.filter((quest) => quest.status === "superseded"),
    ...stories.filter((quest) => quest.status === "fulfilled"),
  ];
}

export function questCards(world, actor = currentActor(world)) {
  return questHistoryCards(world, actor)
    .filter((card) => {
      if (card.ongoing) return true;
      const q = world.quests?.records?.[card.key];
      if (!q) return !world.life?.actors?.[actor]?.collection && !card.story;
      if (!questFresh(world, q)) return false;
      if (world.actors[actor]) return questCarried(world, actor, q.key);
      const holder = questHolderActor(world, q);
      return holder ? questCarried(world, holder, q.key) : true;
    })
    .slice(0, 2);
}

export function playerQuest(world) {
  return questCards(world).find((quest) => quest.status === "active") || null;
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
  // Cards in one story family keep a distinct view ID for each saved wish.
  if (quest.id && !quest.keyedCard) return quest.id;
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
  if (!world.actors[actor] && !world.items[actor] && !places[actor])
    return null;
  return (
    questCards(world, actor).find(
      (quest) => questCardId(world, quest, notice) === id,
    ) || null
  );
}

export function questHand(world, notice = null) {
  const visible = availableCards(world),
    cards = [];
  const appendQuests = (holder) => {
    const deck = questCards(world, holder).filter((card) => {
      const owner = world.items[holder] && rootHolder(world, holder);
      return (
        !world.actors[owner] ||
        !questCards(world, owner).some((q) => q.key === card.key)
      );
    });
    if (
      holder === currentActor(world) &&
      notice &&
      deck.length < 2 &&
      questCarried(world, holder, notice.key) &&
      !deck.some((quest) => quest.key === notice.key)
    )
      deck.push(notice);
    cards.push(...deck.map((quest) => questCardId(world, quest, notice)));
  };
  for (let index = 0; index < visible.length; index++) {
    const holder = visible[index];
    cards.push(holder);
    if (people[holder]) {
      while (
        things[visible[index + 1]] &&
        rootHolder(world, visible[index + 1]) === holder
      ) {
        const item = visible[++index];
        cards.push(item);
        appendQuests(item);
      }
    }
    appendQuests(holder);
  }
  return cards;
}
