import {
  beginLearning as prepare,
  finishLearning,
  learnedPlan,
  trialFacts,
  validTrial,
  TRIAL_LIMIT,
  learningIntent,
} from "./adaptive-learning.mjs";
import { audienceMemory, privateAudienceAllows } from "./reading-privacy.mjs";
import { projectReadingView } from "./reading-actions.mjs";
// Lessons come from completed requests. The same rules record and use them in
// solo play and the shared interpreter.
export const LEARNING_LIMIT = 8;
const kinds = ["ask", "accompany"];
const keyOf = (a) =>
  [a.kind, a.target, a.item || "", a.destination || ""].join(":");

export function requestConditions(world, action) {
  const target = world.actors[action.target];
  return JSON.stringify([
    target?.place,
    target?.trust?.[action.actor] || 0,
    (world.motives?.grievances[action.target] || []).map((g) => [
      g.other,
      g.kind,
      g.weight,
    ]),
    [
      world.actors[action.target]?.progress?.program,
      world.actors[action.target]?.progress?.step,
    ],
    world.life?.actors?.[action.target]?.phase || null,
    Object.keys(world.items)
      .sort()
      .filter(
        (id) =>
          id === action.item ||
          [action.actor, action.target].includes(world.items[id].holder),
      )
      .map((id) => {
        const item = world.items[id];
        return [id, item.holder, item.fuel ?? null, item.doses ?? null];
      }),
    world.actors[action.actor]?.place,
    learningIntent(world, action.actor),
  ]);
}

export function beginLearning(world, action) {
  if (world.motives?.version !== 1) return null;
  return prepare(world, action, requestConditions);
}
export function recordLearning(world, action, prepared, event) {
  finishLearning(world, action, prepared, event, requestConditions);
}
export function reconsiderPlan(world, actor, selected, actions) {
  return learnedPlan(world, actor, selected, actions, requestConditions);
}

export function learningFacts(world, actor, nameOf) {
  const facts = trialFacts(world, actor, nameOf);
  if (facts) return facts;
  const lesson = world.memories[actor]?.learning?.at(-1);
  if (!lesson) return [];
  const other = nameOf(lesson.target);
  return [
    `I expected ${other} to ${lesson.expected ? "agree" : "decline"}. ${other} ${lesson.observed ? "agreed" : "declined"}. ${lesson.strategy === "offer_trade" ? "I will try a fair trade when one is available." : lesson.strategy === "give_space" ? "I will give them time and talk first." : "I can continue with their agreement."}`,
  ];
}

export function validLearning(world, actor, lessons, profiles) {
  if (lessons === undefined) return true;
  const valid =
    Array.isArray(lessons) &&
    lessons.length <= TRIAL_LIMIT &&
    lessons.every((l, i) => {
      if (
        !l ||
        !Number.isSafeInteger(l.seq) ||
        l.seq <= 0 ||
        l.seq > world.eventSeq ||
        !Number.isSafeInteger(l.turn) ||
        l.turn < 0 ||
        l.turn > world.turn ||
        (i && l.seq <= lessons[i - 1].seq)
      )
        return false;
      if (l.version === 2) return validTrial(world, actor, l, profiles);
      if (!l || Object.keys(l).length !== (l.followup ? 13 : 12)) return false;
      const action = {
        kind: l.kind,
        target: l.target,
        item: l.item,
        destination: l.destination,
      };
      const source = world.log.find((e) => e.seq === l.seq);
      return (
        (!l.followup ||
          (Number.isSafeInteger(l.followup.seq) &&
            l.followup.seq > l.seq &&
            l.followup.seq <= world.eventSeq &&
            Number.isSafeInteger(l.followup.turn) &&
            l.followup.turn >= l.turn &&
            l.followup.turn <= world.turn &&
            ["talk", "trade", "wait"].includes(l.followup.kind))) &&
        Number.isSafeInteger(l.seq) &&
        l.seq > 0 &&
        l.seq <= world.eventSeq &&
        (!i || lessons[i - 1].seq < l.seq) &&
        Number.isSafeInteger(l.turn) &&
        l.turn >= 0 &&
        l.turn <= world.turn &&
        kinds.includes(l.kind) &&
        Boolean(world.actors[l.target]) &&
        l.target !== actor &&
        (l.item === null || Boolean(world.items[l.item])) &&
        (l.destination === null ||
          profiles[l.destination]?.kind === "location") &&
        (l.kind === "ask"
          ? l.item !== null && l.destination === null
          : l.destination !== null && l.item === null) &&
        l.key === keyOf(action) &&
        typeof l.expected === "boolean" &&
        typeof l.observed === "boolean" &&
        l.strategy ===
          (l.observed
            ? "continue"
            : l.kind === "ask"
              ? "offer_trade"
              : "give_space") &&
        typeof l.conditions === "string" &&
        l.conditions.length <= 16000 &&
        typeof l.evidence === "string" &&
        l.evidence.length > 0 &&
        l.evidence.length <= 650 &&
        (!source ||
          (!source.generated &&
            source.actorId === actor &&
            source.verb === l.kind &&
            source.targetId === l.target &&
            source.accepted === l.observed &&
            source.text.slice(0, 650) === l.evidence))
      );
    });
  return valid;
}

// Public character text remains available on cards. A player's own inner life
// belongs to that player; resident inner life stays with the simulation.
export function privateView(world, actor) {
  const view = structuredClone(world);
  const readingView = projectReadingView(world, actor);
  if (Object.keys(readingView.packs).length) {
    view.readingView = readingView;
    for (const state of Object.values(view.packs)) delete state.poemReadings;
  }
  view.log = view.log.filter((entry) => privateAudienceAllows(entry, [actor]));
  for (const [id, memory] of Object.entries(view.memories)) {
    Object.assign(memory, audienceMemory(memory, [actor]));
    if (id === actor) continue;
    delete memory.innerLife;
    delete memory.reflections;
    delete memory.learning;
  }
  return view;
}
