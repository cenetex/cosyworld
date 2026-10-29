import { carryQuest } from "./quest-hands.mjs";
import { personalLegacyCardVisible } from "./pack-personal-quests.mjs";
import {
  authoredPlayerStoryIds,
  authoredPlayerStoryDefinitions,
  matchesAuthoredPlayerStory,
} from "./authored-player-story-quests.mjs";
import { packDefinitions } from "./pack-registry.mjs";
import {
  authoredStoryIds,
  authoredStoryDefinitions,
  authoredStoryRelation,
} from "./pack-story-quests.mjs";
import {
  installSharedQuestRegistry,
  clearQuestFocus,
} from "./shared-quests.mjs";

export const STORY_QUEST_CARDS = [
  ...authoredStoryIds(packDefinitions),
  ...authoredPlayerStoryIds(packDefinitions),
];

export function storyDefinitions(world, history = false) {
  return [
    ...authoredStoryDefinitions(world, packDefinitions, { history }),
    ...authoredPlayerStoryDefinitions(world, packDefinitions),
  ];
}

const packFor = (definition) =>
  packDefinitions.find((pack) => definition.key.startsWith(`${pack.id}:`));
const relation = (definition) =>
  definition.personalOwner
    ? (event) => event.questKey === definition.key
    : authoredStoryRelation(packDefinitions, definition);

// Saved deeds and required reading starts identify story participants.
export function storyActors(
  world,
  definition,
  includeDiscovery = true,
  related = relation(definition),
) {
  if (definition.personalOwner) return [...definition.completionParticipants];
  const pack = packFor(definition);
  if (!pack) return [];
  const events = (world.log || []).filter(related);
  const discovery = (world.log || [])
    .filter(
      (event) =>
        event.kind === "action" &&
        event.turn === definition.createdTurn &&
        (event.packId === pack.id ||
          event.cast?.includes(definition.holder.id) ||
          (definition.holder.kind === "place" &&
            event.locationId === definition.holder.id)),
    )
    .sort((a, b) => a.seq - b.seq)[0];
  if (includeDiscovery && discovery) events.push(discovery);
  const state = world.packs?.[pack.id];
  const knownAuthor = state?.recitals?.[definition.choiceId]?.actor;
  const completedTurn = state?.receipts?.[definition.choiceId];
  const story = pack.storyQuests?.find(
    (entry) => `${pack.id}:${entry.key || entry.id}` === definition.key,
  );
  const readingChoices = new Set([
    definition.choiceId,
    ...(story?.progress || []),
  ]);
  const readingSites = new Map(
    (pack.recital?.sites || [])
      .filter((site) => readingChoices.has(site.completion))
      .map((site) => [site.id, state?.receipts?.[site.completion]]),
  );
  // The saved reader keeps the task when the record rests on the table.
  // Later readings keep their archive credit after the recorded stage ends.
  const readers = readingSites.size
    ? Object.values(state?.poemReadings?.readings || {})
        .filter(
          (reading) =>
            readingSites.has(reading.site) &&
            reading.turn >= definition.createdTurn &&
            reading.turn <= (readingSites.get(reading.site) ?? Infinity) &&
            (completedTurn === undefined || reading.turn <= completedTurn),
        )
        .map((reading) => reading.reader)
    : [];
  return [
    ...new Set(
      [...events.map((event) => event.actorId), knownAuthor, ...readers].filter(
        (id) => world.actors[id],
      ),
    ),
  ].sort();
}

// Authored choices own their outcome. The registry retains the card and its people.
// Migration keeps unknown old actors and sites unknown when the event was pruned.
export function syncStoryQuests(world, actorId = null) {
  const definitions = storyDefinitions(world, true);
  if (!definitions.length) return [];
  const registry = installSharedQuestRegistry(world),
    completions = [];
  // A hidden earlier household request keeps its record and frees its hand slot.
  for (const [actor, hand] of Object.entries(registry.hands || {}))
    registry.hands[actor] = hand.filter((key) => {
      const quest = registry.records[key];
      return !quest || quest.mode !== "story" || quest.completedTurn !== null ||
        personalLegacyCardVisible(world, packDefinitions, quest.program.id, actor);
    });
  for (const definition of definitions) {
    const pack = packFor(definition);
    const state = world.packs[pack.id];
    let quest = registry.records[definition.key];
    // Finished cards in an upgraded household keep their exact saved record.
    // Validation still checks every field against its original definition.
    if (quest?.completion && quest.completedTurn !== null &&
      (definition.personalOwner || pack.personalQuests?.some((entry) => entry.legacy)))
      continue;
    const created = !quest;
    if (!quest) {
      quest = registry.records[definition.key] = {
        key: definition.key,
        mode: "story",
        holder: structuredClone(definition.holder),
        subjectActor: null,
        rewardActor: null,
        participants: [],
        program: {
          id: definition.id,
          name: definition.title,
          purpose: definition.purpose,
          art: definition.art,
          steps: [],
        },
        step: 0,
        totalSteps: 1,
        createdTurn: definition.createdTurn,
        completedTurn: null,
        origin: null,
        cause: null,
      };
    }
    const related = relation(definition);
    const events = (world.log || []).filter(related);
    // The first discovery is saved on creation. Once its log entry ages out,
    // a later unrelated event at the same turn cannot replace that witness.
    const recorded = storyActors(world, definition, created, related);
    const knownAuthor = state.recitals?.[definition.choiceId]?.actor;
    if (
      created &&
      !definition.personalOwner &&
      actorId &&
      world.actors[actorId] &&
      definition.createdTurn === world.turn
    )
      recorded.push(actorId);
    const previous = new Set(quest.participants);
    quest.participants = [
      ...new Set([...quest.participants, ...recorded]),
    ].sort();
    if (registry.hands) {
      for (const actor of quest.participants.filter((id) => !previous.has(id)))
        carryQuest(world, actor, quest);
      if ((created && quest.holder.kind === "avatar") ||
        (definition.personalOwner && !definition.resolved))
        carryQuest(world, quest.holder.id, quest);
    }
    if (!definition.resolved) continue;
    const event = events.find((entry) => definition.personalOwner
      ? entry.verb === "personal-quest-complete" &&
        entry.seq === definition.completionSeq
      : entry.choiceId === definition.choiceId);
    quest.step = 1;
    quest.completedTurn = definition.personalOwner
      ? definition.completedTurn
      : state.receipts[definition.choiceId];
    clearQuestFocus(world, quest.key);
    if (!quest.completion)
      completions.push({
        questKey: quest.key,
        capturedSeq: event?.seq || 0,
        turn: quest.completedTurn,
        actorId: definition.personalOwner
          ? definition.completionActorId
          : event?.actorId || knownAuthor || null,
        locationId: definition.personalOwner
          ? definition.completionLocationId
          : event?.locationId || null,
        participants: definition.personalOwner
          ? [...definition.completionParticipants]
          : [...new Set(recorded)].sort(),
        outcome: definition.completion.toLowerCase(),
      });
  }
  return completions;
}

export function validStoryQuest(world, quest) {
  return createStoryQuestValidator(world)(quest);
}

// Use one validator while this world stays unchanged. Each later operation
// builds its own definitions from the receipts and account choices then present.
export function createStoryQuestValidator(world) {
  let definitions;
  return (quest) => {
    definitions ??= new Map(
      storyDefinitions(world, true).map((card) => [card.key, card]),
    );
    return matchesStoryQuest(world, quest, definitions.get(quest.key));
  };
}

function matchesStoryQuest(world, quest, definition) {
  const state = definition && world.packs[packFor(definition).id];
  return Boolean(
    definition &&
      quest.subjectActor === null &&
      quest.rewardActor === null &&
      quest.holder.kind === definition.holder.kind &&
      quest.holder.id === definition.holder.id &&
      quest.program?.id === definition.id &&
      quest.program.name === definition.title &&
      quest.program.purpose === definition.purpose &&
      quest.program.art === definition.art &&
      Array.isArray(quest.program.steps) &&
      quest.program.steps.length === 0 &&
      quest.totalSteps === 1 &&
      quest.step === Number(definition.resolved) &&
      quest.origin === null &&
      quest.cause === null &&
      !quest.retired &&
      quest.completedTurn ===
        (definition.personalOwner
          ? definition.completedTurn
          : definition.resolved ? state.receipts[definition.choiceId] : null) &&
      matchesAuthoredPlayerStory(quest, definition) &&
      (!quest.completion ||
        quest.completion.outcome === definition.completion.toLowerCase()),
  );
}
