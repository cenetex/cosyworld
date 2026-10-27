import { packDefinition } from "./pack-registry.mjs";
import {
  installSharedQuestRegistry,
  clearQuestFocus,
} from "./shared-quests.mjs";

export const STORY_QUEST_CARDS = [
  "story-quest-greek-table",
  "story-quest-greek-burial",
  "story-quest-greek-courtyard",
];
const lines = [
  "A place beside the bread.",
  "Her brother waits for earth.",
  "What words will you bring home?",
];
const holders = [
  { kind: "avatar", id: "greek-baker" },
  { kind: "avatar", id: "greek-antigone" },
  { kind: "place", id: "greek-courtyard" },
];

export function storyDefinitions(world, history = false) {
  const state = world.packs?.["greek-drama"];
  if (!state) return [];
  const flags = state.flags || {},
    met = state.met || {},
    receipts = state.receipts || {};
  const response = state.choices?.["greek-theban-response"],
    buried = flags["greek-burial-performed"] === true;
  const returned = flags["greek-water-returned"] === true,
    publicOutcome = flags[`greek-${response}-public`] === true;
  const graveReturn = response === "concession" && buried && publicOutcome;
  const burialChoice =
    receipts["greek-perform-permitted-burial"] !== undefined
      ? "greek-perform-permitted-burial"
      : "greek-perform-burial";
  const responseChoice = packDefinition("greek-drama").choices.find((choice) =>
    choice.effects.some(
      (effect) =>
        effect.kind === "choose" &&
        effect.key === "greek-theban-response" &&
        effect.value === response,
    ),
  );
  const card = (
    index,
    art,
    resolved,
    choiceId,
    completion = "Fulfilled",
    grave = false,
  ) => ({
    id: STORY_QUEST_CARDS[index],
    key: `greek-drama:${STORY_QUEST_CARDS[index]}${grave ? ":grave" : ""}`,
    title: lines[index],
    purpose: lines[index],
    singleLine: true,
    story: true,
    status: resolved ? "fulfilled" : "pending",
    art,
    resolved,
    completion,
    holder: holders[index],
    choiceId,
    createdTurn:
      index === 0
        ? (met["greek-baker"] ?? receipts[choiceId] ?? 0)
        : index === 1
          ? (met["greek-antigone"] ??
            receipts["greek-hear-decree"] ??
            receipts[choiceId] ??
            0)
          : grave
            ? Math.max(
                receipts[burialChoice] || 0,
                receipts["greek-courtyard-concession"] || 0,
              )
            : (receipts[responseChoice?.id] ?? 0),
  });
  const cards = [];
  if (Object.hasOwn(met, "greek-baker") || returned)
    cards.push(card(0, "greek-water-jar", returned, "greek-return-water-jar"));
  if (
    Object.hasOwn(met, "greek-antigone") ||
    flags["greek-decree-known"] ||
    response ||
    buried
  ) {
    const ending = {
      refusal: ["greek-decline-burial", "Declined"],
      exposure: ["greek-report-plan", "Reported"],
    }[response];
    cards.push(
      card(
        1,
        "greek-funeral-cloth",
        buried || Boolean(ending),
        ending?.[0] || burialChoice,
        ending?.[1] || "Fulfilled",
      ),
    );
  }
  if (response) {
    cards.push(
      card(
        2,
        "greek-bread",
        publicOutcome &&
          (!graveReturn || flags["greek-permitted-burial-public"] === true),
        graveReturn
          ? "greek-courtyard-permitted-burial"
          : `greek-courtyard-${response}`,
        "Shared",
        graveReturn,
      ),
    );
    if (history && graveReturn)
      cards.push({
        ...card(2, "greek-bread", true, "greek-courtyard-concession", "Shared"),
        historical: true,
      });
  }
  return cards;
}

const related = (definition, event) => {
  if (event.packId !== "greek-drama" || !event.choiceId) return false;
  if (definition.id === STORY_QUEST_CARDS[0])
    return event.choiceId === "greek-return-water-jar";
  if (definition.id === STORY_QUEST_CARDS[2])
    return event.choiceId === definition.choiceId;
  return [
    "greek-hear-decree",
    "greek-decline-burial",
    "greek-report-plan",
    "greek-prepare-burial-ground",
    "greek-prepare-permitted-burial",
    "greek-perform-burial",
    "greek-perform-permitted-burial",
    "greek-petition-burial",
  ].includes(event.choiceId);
};

// Saved action authors identify who discovered or contributed to a story card.
// A viewer and a global meeting flag carry no personal participation evidence.
export function storyActors(world, definition) {
  const events = (world.log || []).filter((event) =>
    related(definition, event),
  );
  const discovery = (world.log || [])
    .filter(
      (event) =>
        event.kind === "action" &&
        event.turn === definition.createdTurn &&
        (event.packId === "greek-drama" ||
          event.cast?.includes(definition.holder.id) ||
          (definition.holder.kind === "place" &&
            event.locationId === definition.holder.id)),
    )
    .sort((a, b) => a.seq - b.seq)[0];
  if (discovery) events.push(discovery);
  const knownAuthor =
    world.packs?.["greek-drama"]?.recitals?.[definition.choiceId]?.actor;
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
  const state = world.packs["greek-drama"];
  for (const definition of definitions) {
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
    const events = (world.log || []).filter((event) =>
      related(definition, event),
    );
    const recorded = storyActors(world, definition);
    const knownAuthor = state.recitals?.[definition.choiceId]?.actor;
    if (
      created &&
      actorId &&
      world.actors[actorId] &&
      definition.createdTurn === world.turn
    )
      recorded.push(actorId);
    quest.participants = [
      ...new Set([...quest.participants, ...recorded]),
    ].sort();
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
  const definition = storyDefinitions(world, true).find(
    (card) => card.key === quest.key,
  );
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
        (definition.resolved
          ? world.packs["greek-drama"].receipts[definition.choiceId]
          : null) &&
      (!quest.completion ||
        quest.completion.outcome === definition.completion.toLowerCase()),
  );
}
