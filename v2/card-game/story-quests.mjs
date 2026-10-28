import { carryQuest } from "./quest-hands.mjs";
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

export const STORY_QUEST_CARDS = authoredStoryIds(packDefinitions);

export function storyDefinitions(world, history = false) {
  return authoredStoryDefinitions(world, packDefinitions, { history });
}

const packFor = (definition) =>
  packDefinitions.find((pack) => definition.key.startsWith(`${pack.id}:`));
const relation = (definition) =>
  authoredStoryRelation(packDefinitions, definition);

// Saved action authors identify who discovered or contributed to a story card.
// A viewer and a global meeting flag carry no personal participation evidence.
export function storyActors(
  world,
  definition,
  includeDiscovery = true,
  related = relation(definition),
) {
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
  const knownAuthor =
    world.packs?.[pack.id]?.recitals?.[definition.choiceId]?.actor;
  return [
    ...new Set(
      [...events.map((event) => event.actorId), knownAuthor].filter(
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
  for (const definition of definitions) {
    const state = world.packs[packFor(definition).id];
    let quest = registry.records[definition.key];
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
      if (created && quest.holder.kind === "avatar")
        carryQuest(world, quest.holder.id, quest);
    }
    if (!definition.resolved) continue;
    const event = events.find(
      (entry) => entry.choiceId === definition.choiceId,
    );
    quest.step = 1;
    quest.completedTurn = state.receipts[definition.choiceId];
    clearQuestFocus(world, quest.key);
    if (!quest.completion)
      completions.push({
        questKey: quest.key,
        capturedSeq: event?.seq || 0,
        turn: quest.completedTurn,
        actorId: event?.actorId || knownAuthor || null,
        locationId: event?.locationId || null,
        participants: [...new Set(recorded)].sort(),
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
        (definition.resolved ? state.receipts[definition.choiceId] : null) &&
      (!quest.completion ||
        quest.completion.outcome === definition.completion.toLowerCase()),
  );
}
